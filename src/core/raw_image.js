/* Copyright 2026 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { BaseStream } from "./base_stream.js";
import { JpegStream } from "./jpeg_stream.js";
import { Name } from "./primitives.js";

const COMPONENTS = { DeviceGray: 1, DeviceRGB: 3, DeviceCMYK: 4 };
const ICC_SIGNATURES = { 1: "GRAY", 3: "RGB ", 4: "CMYK" };

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function resolveColorSpace(value, xref, resources) {
  value = xref.fetchIfRef(value);
  if (
    value instanceof Name &&
    !(value.name in COMPONENTS) &&
    !["G", "RGB", "CMYK"].includes(value.name)
  ) {
    const named = resources?.get("ColorSpace")?.get(value.name);
    if (named) {
      value = xref.fetchIfRef(named);
    }
  }
  if (value instanceof Name) {
    const aliases = { G: "DeviceGray", RGB: "DeviceRGB", CMYK: "DeviceCMYK" };
    return { name: aliases[value.name] || value.name };
  }
  if (!Array.isArray(value) || !(xref.fetchIfRef(value[0]) instanceof Name)) {
    return null;
  }
  const name = xref.fetchIfRef(value[0]).name;
  if (name !== "ICCBased" || value.length !== 2) {
    return { name };
  }
  const stream = xref.fetchIfRef(value[1]);
  if (!(stream instanceof BaseStream)) {
    return { name, invalid: true };
  }
  const n = stream.dict.get("N");
  if (!Number.isInteger(n) || !ICC_SIGNATURES[n]) {
    return { name, n, invalid: true };
  }
  const previousPosition = stream.pos;
  stream.reset();
  const profile = stream.getBytes().slice();
  stream.pos = previousPosition;
  const declaredLength =
    ((profile[0] << 24) |
      (profile[1] << 16) |
      (profile[2] << 8) |
      profile[3]) >>>
    0;
  const valid =
    profile.length >= 128 &&
    declaredLength === profile.length &&
    readAscii(profile, 36, 4) === "acsp" &&
    readAscii(profile, 16, 4) === ICC_SIGNATURES[n];
  return { name, n, profile, invalid: !valid };
}

/**
 * Return a structured-cloneable description of the original image stream.
 * Only `eligible` images may be decoded outside pdf.js. Other images retain
 * their ordinary rasterized image object and an explicit rejection reason.
 */
function getRawImageData({ imageObj, xref, resources }) {
  const { image } = imageObj;
  const { dict } = image;
  const filterValue = dict.get("F", "Filter");
  const filters = (
    Array.isArray(filterValue) ? filterValue : [filterValue]
  ).map(value => xref.fetchIfRef(value)?.name ?? null);
  const paramsValue = dict.get("DP", "DecodeParms");
  const params = Array.isArray(paramsValue) ? paramsValue[0] : paramsValue;
  const colorTransform = params?.get?.("ColorTransform") ?? null;
  const rawColorSpace = dict.getRaw("CS") || dict.getRaw("ColorSpace");
  const colorSpace = resolveColorSpace(rawColorSpace, xref, resources);
  const mask = dict.getArray("Mask") || dict.get("Mask");
  const softMask = dict.get("SMask");
  let maskDescription = null;
  if (Array.isArray(mask)) {
    maskDescription = { type: "colorKey", ranges: mask };
  } else if (mask) {
    maskDescription = { type: "image" };
  }
  const result = {
    version: 1,
    eligible: false,
    reason: null,
    width: imageObj.width,
    height: imageObj.height,
    bitsPerComponent: imageObj.bpc,
    filter: filters,
    decodeParms: { colorTransform },
    colorSpace,
    decode: imageObj.decode || null,
    interpolate: imageObj.interpolate === true,
    mask: maskDescription,
    softMask: softMask ? { type: "image" } : null,
    matte: dict.getArray("Matte") || null,
    data: null,
  };

  let reason;
  if (filters.length !== 1 || !["DCTDecode", "DCT"].includes(filters[0])) {
    reason = "UNSUPPORTED_FILTER";
  } else if (!(image instanceof JpegStream)) {
    reason = "UNSUPPORTED_STREAM";
  } else if (imageObj.imageMask || mask || softMask || imageObj.matte) {
    reason = "MASKED_IMAGE";
  } else if (
    colorTransform !== null &&
    colorTransform !== 0 &&
    colorTransform !== 1
  ) {
    reason = "INVALID_DECODE_PARMS";
  } else if (!colorSpace || colorSpace.invalid) {
    reason = "INVALID_COLOR_SPACE";
  } else if (
    !(colorSpace.name in COMPONENTS) &&
    colorSpace.name !== "ICCBased"
  ) {
    reason = "UNSUPPORTED_COLOR_SPACE";
  } else if (
    colorSpace.name !== "ICCBased" &&
    imageObj.colorSpace?.name !== colorSpace.name
  ) {
    reason = "COLOR_SPACE_FALLBACK";
  } else {
    const components =
      colorSpace.name === "ICCBased"
        ? colorSpace.n
        : COMPONENTS[colorSpace.name];
    if (imageObj.numComps !== components) {
      reason = "COMPONENT_MISMATCH";
    } else if (imageObj.bpc !== 8) {
      reason = "UNSUPPORTED_BITS_PER_COMPONENT";
    } else if (
      imageObj.decode &&
      (imageObj.decode.length !== 2 * components ||
        !imageObj.decode.every(Number.isFinite))
    ) {
      reason = "INVALID_DECODE";
    } else if (
      !Number.isSafeInteger(imageObj.width) ||
      !Number.isSafeInteger(imageObj.height) ||
      imageObj.width <= 0 ||
      imageObj.height <= 0
    ) {
      reason = "INVALID_DIMENSIONS";
    }
  }

  if (reason) {
    result.reason = reason;
    return result;
  }
  const data = image.bytes.slice();
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    result.reason = "INVALID_JPEG";
    return result;
  }
  result.eligible = true;
  result.data = data;
  return result;
}

export { getRawImageData };
