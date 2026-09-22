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

import { Dict, Name } from "./primitives.js";
import { BaseStream } from "./base_stream.js";
import { JpegStream } from "./jpeg_stream.js";

const COMPONENTS = { DeviceGray: 1, DeviceRGB: 3, DeviceCMYK: 4 };
const ICC_SIGNATURES = { 1: "GRAY", 3: "RGB ", 4: "CMYK" };

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function serialize(value, xref, seen = new Set()) {
  value = xref.fetchIfRef(value);
  if (value instanceof Name) {
    return value.name;
  }
  if (value instanceof BaseStream) {
    return { reason: "STREAM_VALUE" };
  }
  if (value instanceof Dict) {
    if (seen.has(value)) {
      return { reason: "CIRCULAR_VALUE" };
    }
    seen.add(value);
    const result = Object.create(null);
    for (const key of value.getKeys()) {
      result[key] = serialize(value.getRaw(key), xref, seen);
    }
    seen.delete(value);
    return result;
  }
  if (Array.isArray(value)) {
    return value.map(item => serialize(item, xref, seen));
  }
  return value instanceof Uint8Array ? value.slice() : value;
}

function resolveColorSpace(value, xref, resources) {
  value = xref.fetchIfRef(value);
  if (
    value instanceof Name &&
    !(value.name in COMPONENTS) &&
    !["G", "RGB", "CMYK"].includes(value.name)
  ) {
    value =
      xref.fetchIfRef(resources?.get("ColorSpace")?.get(value.name)) || value;
  }
  if (value instanceof Name) {
    const aliases = { G: "DeviceGray", RGB: "DeviceRGB", CMYK: "DeviceCMYK" };
    const kind = aliases[value.name] || value.name;
    return COMPONENTS[kind] ? { kind, components: COMPONENTS[kind] } : { kind };
  }
  if (!Array.isArray(value) || !(xref.fetchIfRef(value[0]) instanceof Name)) {
    return null;
  }
  const kind = xref.fetchIfRef(value[0]).name;
  if (kind !== "ICCBased" || value.length !== 2) {
    return { kind };
  }
  const stream = xref.fetchIfRef(value[1]);
  if (!(stream instanceof BaseStream)) {
    return { kind, invalid: "INVALID_ICC_PROFILE" };
  }
  const components = stream.dict.get("N");
  if (!Number.isInteger(components) || !ICC_SIGNATURES[components]) {
    return { kind, components, invalid: "INVALID_ICC_COMPONENT_COUNT" };
  }
  const position = stream.pos;
  let profile;
  try {
    stream.reset();
    profile = stream.getBytes().slice();
  } finally {
    stream.pos = position;
  }
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
    readAscii(profile, 16, 4) === ICC_SIGNATURES[components];
  return {
    kind,
    components,
    profile,
    invalid: valid ? null : "INVALID_ICC_PROFILE",
  };
}

function resolveEffectiveColorSpace(
  value,
  sourceColorSpace,
  imageObj,
  xref,
  resources
) {
  const raw = xref.fetchIfRef(value);
  if (raw instanceof Name) {
    const aliases = { G: "DeviceGray", RGB: "DeviceRGB", CMYK: "DeviceCMYK" };
    const kind = aliases[raw.name] || raw.name;
    const defaultColorSpace = resources
      ?.get("ColorSpace")
      ?.get(`Default${kind.replace("Device", "")}`);
    if (defaultColorSpace) {
      return resolveColorSpace(defaultColorSpace, xref, resources);
    }
  }
  if (sourceColorSpace) {
    return sourceColorSpace;
  }
  const kind = imageObj.colorSpace?.name;
  return COMPONENTS[kind] ? { kind, components: COMPONENTS[kind] } : null;
}

function decodeParms(dict, xref) {
  const value = dict.getRaw("DP") ?? dict.getRaw("DecodeParms");
  if (value === undefined) {
    return null;
  }
  return (Array.isArray(value) ? value : [value]).map(item =>
    item === null || item === undefined ? null : serialize(item, xref)
  );
}

function rawMask(value, kind, xref, resources) {
  if (Array.isArray(value)) {
    return { kind: "colorKey", ranges: value.slice() };
  }
  const stream = xref.fetchIfRef(value);
  if (!(stream instanceof BaseStream)) {
    return { kind, reason: "UNSUPPORTED_COMPOSITING" };
  }
  const dict = stream.dict;
  if (kind === "softMask" && dict.get("Subtype") instanceof Name) {
    const group = dict.get("Group");
    const subtype = dict.get("S");
    return {
      kind,
      subtype: subtype instanceof Name ? subtype.name : null,
      groupColorSpace:
        group instanceof Dict
          ? resolveColorSpace(group.getRaw("CS"), xref, resources)
          : null,
      isolated: group instanceof Dict ? group.get("I") === true : false,
      knockout: group instanceof Dict ? group.get("K") === true : false,
      bbox: dict.getArray("BBox") || null,
      matrix: dict.getArray("Matrix") || null,
      reason: "UNSUPPORTED_COMPOSITING",
    };
  }
  const filterValue = dict.get("F", "Filter");
  const filters = (Array.isArray(filterValue) ? filterValue : [filterValue])
    .filter(Boolean)
    .map(filter => xref.fetchIfRef(filter)?.name ?? null);
  return {
    kind,
    bytes: stream instanceof JpegStream ? stream.bytes.slice() : undefined,
    filters,
    decodeParms: decodeParms(dict, xref),
    decode: dict.getArray("D", "Decode") || null,
    width: dict.get("W", "Width") ?? null,
    height: dict.get("H", "Height") ?? null,
    bitsPerComponent: dict.get("BPC", "BitsPerComponent") ?? null,
    sourceColorSpace: resolveColorSpace(
      dict.getRaw("CS") || dict.getRaw("ColorSpace"),
      xref,
      resources
    ),
  };
}

function getRawImageData({ imageObj, xref, resources }) {
  const { image } = imageObj;
  const { dict } = image;
  const filterValue = dict.get("F", "Filter");
  const filters = (Array.isArray(filterValue) ? filterValue : [filterValue])
    .filter(Boolean)
    .map(value => xref.fetchIfRef(value)?.name ?? null);
  const rawColorSpace = dict.getRaw("CS") || dict.getRaw("ColorSpace");
  const sourceColorSpace = resolveColorSpace(rawColorSpace, xref, resources);
  const effectiveColorSpace = resolveEffectiveColorSpace(
    rawColorSpace,
    sourceColorSpace,
    imageObj,
    xref,
    resources
  );
  const maskValue = dict.getRaw("Mask"),
    softMaskValue = dict.getRaw("SMask");
  const matte = dict.getArray("Matte") || null;
  const result = {
    version: 1,
    eligible: false,
    reason: null,
    width: imageObj.width,
    height: imageObj.height,
    bitsPerComponent: imageObj.bpc,
    bytes: null,
    filters,
    decodeParms: decodeParms(dict, xref),
    decode: imageObj.decode?.slice() || null,
    interpolate: imageObj.interpolate === true,
    sourceColorSpace,
    effectiveColorSpace,
    mask: maskValue ? rawMask(maskValue, "image", xref, resources) : null,
    softMask: softMaskValue
      ? rawMask(softMaskValue, "softMask", xref, resources)
      : null,
    matte,
  };
  const paramsValid =
    result.decodeParms === null ||
    (result.decodeParms.length === 1 &&
      (result.decodeParms[0] === null ||
        typeof result.decodeParms[0] === "object"));
  const colorTransform = result.decodeParms?.[0]?.ColorTransform;
  let reason = null;
  if (filters.length !== 1 || !["DCTDecode", "DCT"].includes(filters[0])) {
    reason = "UNSUPPORTED_FILTER";
  } else if (!(image instanceof JpegStream)) {
    reason = "INVALID_STREAM";
  } else if (
    !Number.isSafeInteger(result.width) ||
    !Number.isSafeInteger(result.height) ||
    result.width <= 0 ||
    result.height <= 0
  ) {
    reason = "INVALID_DIMENSIONS";
  } else if (result.bitsPerComponent !== 8) {
    reason = "INVALID_BITS_PER_COMPONENT";
  } else if (
    !paramsValid ||
    (colorTransform !== null &&
      colorTransform !== undefined &&
      colorTransform !== 0 &&
      colorTransform !== 1)
  ) {
    reason = "INVALID_DECODE_PARMS";
  } else if (!effectiveColorSpace) {
    reason = "INVALID_COLOR_SPACE";
  } else if (effectiveColorSpace.invalid) {
    reason = effectiveColorSpace.invalid;
  } else if (["Separation", "DeviceN"].includes(effectiveColorSpace.kind)) {
    reason = "SEPARATION_OR_DEVICEN";
  } else if (
    !(effectiveColorSpace.kind in COMPONENTS) &&
    effectiveColorSpace.kind !== "ICCBased"
  ) {
    reason = "UNSUPPORTED_COLOR_SPACE";
  } else if (maskValue || matte || imageObj.imageMask) {
    reason = "MASKED_IMAGE";
  } else if (softMaskValue) {
    reason = "SOFT_MASKED_IMAGE";
  } else if (imageObj.numComps !== effectiveColorSpace.components) {
    reason = "INVALID_COLOR_SPACE";
  } else if (
    result.decode &&
    (result.decode.length !== effectiveColorSpace.components * 2 ||
      !result.decode.every(Number.isFinite))
  ) {
    reason = "INVALID_DECODE";
  }
  if (reason) {
    result.reason = reason;
    return result;
  }
  const bytes = image.bytes.slice();
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    result.reason = "INVALID_JPEG";
    return result;
  }
  result.eligible = true;
  result.bytes = bytes;
  return result;
}

export { getRawImageData };
