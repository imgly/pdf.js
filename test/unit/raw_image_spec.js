import { Dict, Name, Ref } from "../../src/core/primitives.js";
import {
  getRawImageData,
  getRawImageMaskData,
} from "../../src/core/raw_image.js";
import { JpegStream } from "../../src/core/jpeg_stream.js";
import { Stream } from "../../src/core/stream.js";

describe("raw image accessor", function () {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const xref = { fetchIfRef: value => value };

  function makeImage(colorSpace = Name.get("DeviceCMYK"), entries = {}) {
    const dict = new Dict();
    dict.set("Filter", Name.get("DCTDecode"));
    dict.set("ColorSpace", colorSpace);
    for (const [key, value] of Object.entries(entries)) {
      dict.set(key, value);
    }
    const stream = new Stream(jpeg, 0, jpeg.length, dict);
    const image = new JpegStream(stream, jpeg.length, null);
    return {
      image,
      width: 1,
      height: 1,
      bpc: 8,
      numComps: 4,
      colorSpace: { name: "DeviceCMYK" },
      decode: null,
      interpolate: false,
      matte: null,
    };
  }

  function extract(imageObj) {
    return getRawImageData({ imageObj, xref, resources: null });
  }

  it("exposes a valid DeviceCMYK JPEG and its PDF semantics", function () {
    const imageObj = makeImage();
    imageObj.decode = [1, 0, 1, 0, 1, 0, 1, 0];
    const raw = extract(imageObj);
    expect(raw.eligible).toBeTrue();
    expect(raw.bytes).toEqual(jpeg);
    expect(raw.filters).toEqual(["DCTDecode"]);
    expect(raw.sourceColorSpace).toEqual({
      kind: "DeviceCMYK",
      components: 4,
    });
    expect(raw.effectiveColorSpace).toEqual(raw.sourceColorSpace);
    expect(raw.decode).toEqual(imageObj.decode);
  });

  it("rejects Separation even when its alternate is CMYK", function () {
    const raw = extract(
      makeImage([
        Name.get("Separation"),
        Name.get("Spot"),
        Name.get("DeviceCMYK"),
      ])
    );
    expect(raw.eligible).toBeFalse();
    expect(raw.reason).toBe("SEPARATION_OR_DEVICEN");
  });

  it("rejects a malformed ICC component count", function () {
    const profileDict = new Dict();
    profileDict.set("N", 2);
    const profile = new Stream(new Uint8Array(128), 0, 128, profileDict);
    const raw = extract(makeImage([Name.get("ICCBased"), profile]));
    expect(raw.eligible).toBeFalse();
    expect(raw.reason).toBe("INVALID_ICC_COMPONENT_COUNT");
  });

  it("exposes a matching RGB ICC profile", function () {
    const profileBytes = new Uint8Array(128);
    profileBytes[3] = 128;
    profileBytes.set([82, 71, 66, 32], 16); // RGB
    profileBytes.set([97, 99, 115, 112], 36); // acsp
    const profileDict = new Dict();
    profileDict.set("N", 3);
    const profile = new Stream(
      profileBytes,
      0,
      profileBytes.length,
      profileDict
    );
    const imageObj = makeImage([Name.get("ICCBased"), profile]);
    imageObj.numComps = 3;
    // pdf.js v4 uses the ICC /Alternate as its raster color space.
    imageObj.colorSpace = { name: "DeviceRGB" };
    const raw = extract(imageObj);
    expect(raw.eligible).toBeTrue();
    expect(raw.sourceColorSpace.components).toBe(3);
    expect(raw.sourceColorSpace.profile).toEqual(profileBytes);
    expect(raw.effectiveColorSpace).toEqual(raw.sourceColorSpace);
  });

  it("exposes a JPEG with a color-key mask", function () {
    const raw = extract(
      makeImage(Name.get("DeviceCMYK"), { Mask: [0, 0, 0, 0, 0, 0, 0, 0] })
    );
    expect(raw.eligible).toBeTrue();
    expect(raw.reason).toBeNull();
    expect(raw.bytes).toEqual(jpeg);
    expect(raw.mask.kind).toBe("colorKey");
    expect(raw.mask.ranges).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("exposes a JPEG with an image mask", function () {
    const dict = new Dict();
    dict.set("Width", 1);
    dict.set("Height", 1);
    dict.set("ImageMask", true);
    dict.set("Filter", Name.get("CCITTFaxDecode"));
    dict.set("Decode", [1, 0]);
    const raw = extract(
      makeImage(Name.get("DeviceCMYK"), {
        Mask: new Stream(new Uint8Array([0]), 0, 1, dict),
      })
    );
    expect(raw.eligible).toBeTrue();
    expect(raw.bytes).toEqual(jpeg);
    expect(raw.mask.kind).toBe("image");
    expect(raw.mask.imageMask).toBeTrue();
    expect(raw.mask.width).toBe(1);
    expect(raw.mask.height).toBe(1);
    expect(raw.mask.filters).toEqual(["CCITTFaxDecode"]);
    expect(raw.mask.decode).toEqual([1, 0]);
  });

  it("keeps unsupported masks on the raster path", function () {
    const raw = extract(
      makeImage(Name.get("DeviceCMYK"), { Mask: Name.get("Unsupported") })
    );
    expect(raw.eligible).toBeFalse();
    expect(raw.reason).toBe("UNSUPPORTED_MASK_COMPOSITING");
    expect(raw.bytes).toBeNull();
    expect(raw.mask.reason).toBe("UNSUPPORTED_COMPOSITING");
  });

  it("reports a matte without a soft mask", function () {
    const raw = extract(
      makeImage(Name.get("DeviceCMYK"), { Matte: [0, 0, 0, 1] })
    );
    expect(raw.eligible).toBeFalse();
    expect(raw.reason).toBe("MATTE_WITHOUT_SOFT_MASK");
  });

  it("reports a stencil image", function () {
    const imageObj = makeImage();
    imageObj.imageMask = true;
    const raw = extract(imageObj);
    expect(raw.eligible).toBeFalse();
    expect(raw.reason).toBe("IMAGE_MASK");
  });

  it("exposes decoded stencil samples without treating them as JPEG", function () {
    const dict = new Dict();
    dict.set("Width", 9);
    dict.set("Height", 1);
    dict.set("ImageMask", true);
    dict.set("Filter", Name.get("FlateDecode"));
    dict.set("Decode", [1, 0]);
    const image = new Stream(new Uint8Array([0]), 0, 1, dict);
    const data = new Uint8Array([0x80, 0x00]);
    const raw = getRawImageMaskData({
      image,
      xref,
      resources: null,
      width: 9,
      height: 1,
      data,
    });
    data[0] = 0;
    expect(raw.eligible).toBeFalse();
    expect(raw.reason).toBe("IMAGE_MASK");
    expect(raw.bytes).toBeNull();
    expect(raw.bitsPerComponent).toBe(1);
    expect(raw.imageMask.kind).toBe("imageMask");
    expect(raw.imageMask.imageMask).toBeTrue();
    expect(raw.imageMask.filters).toEqual(["FlateDecode"]);
    expect(raw.imageMask.decode).toEqual([1, 0]);
    expect(raw.imageMask.decodedBytes).toEqual(new Uint8Array([0x80, 0x00]));
  });

  it("rejects malformed DCT decode parameters", function () {
    const raw = extract(
      makeImage(Name.get("DeviceCMYK"), { DecodeParms: [null, null] })
    );
    expect(raw.eligible).toBeFalse();
    expect(raw.reason).toBe("INVALID_DECODE_PARMS");
  });

  it("preserves all decode parameter entries as plain values", function () {
    const params = new Dict();
    params.set("ColorTransform", 0);
    params.set("Columns", 1);
    const raw = extract(
      makeImage(Name.get("DeviceCMYK"), { DecodeParms: params })
    );
    expect(raw.eligible).toBeTrue();
    expect(raw.decodeParms).toEqual([{ ColorTransform: 0, Columns: 1 }]);
  });

  it("resolves indirect decode parameter arrays before normalizing them", function () {
    const params = new Dict();
    params.set("ColorTransform", 0);
    const arrayRef = Ref.get(10, 0);
    const paramsRef = Ref.get(11, 0);
    const objects = new Map([
      [arrayRef, [paramsRef]],
      [paramsRef, params],
    ]);
    const imageObj = makeImage(Name.get("DeviceCMYK"), {
      Filter: [Name.get("DCTDecode")],
      DecodeParms: arrayRef,
    });
    const indirectXref = {
      fetchIfRef: value => objects.get(value) ?? value,
    };
    const raw = getRawImageData({
      imageObj,
      xref: indirectXref,
      resources: null,
    });
    expect(raw.eligible).toBeTrue();
    expect(raw.decodeParms).toEqual([{ ColorTransform: 0 }]);

    params.set("ColorTransform", 2);
    expect(
      getRawImageData({ imageObj, xref: indirectXref, resources: null }).reason
    ).toBe("INVALID_DECODE_PARMS");
  });

  it("exposes a JPEG with an image soft mask and preserves its matte", function () {
    const dict = new Dict();
    dict.set("Subtype", Name.get("Image"));
    dict.set("Width", 2);
    dict.set("Height", 3);
    dict.set("BitsPerComponent", 8);
    dict.set("ColorSpace", Name.get("DeviceGray"));
    dict.set("Filter", Name.get("FlateDecode"));
    const params = new Dict();
    params.set("Predictor", 12);
    dict.set("DecodeParms", params);
    dict.set("Decode", [1, 0]);
    dict.set("Matte", [0, 0, 0, 1]);
    const raw = extract(
      makeImage(Name.get("DeviceCMYK"), {
        SMask: new Stream(new Uint8Array(6), 0, 6, dict),
      })
    );
    expect(raw.eligible).toBeTrue();
    expect(raw.reason).toBeNull();
    expect(raw.bytes).toEqual(jpeg);
    expect(raw.softMask).toEqual({
      kind: "softMask",
      bytes: undefined,
      imageMask: false,
      filters: ["FlateDecode"],
      decodeParms: [{ Predictor: 12 }],
      decode: [1, 0],
      matte: [0, 0, 0, 1],
      width: 2,
      height: 3,
      bitsPerComponent: 8,
      sourceColorSpace: { kind: "DeviceGray", components: 1 },
    });
    expect(raw.matte).toEqual([0, 0, 0, 1]);
  });

  it("preserves DCT soft-mask bytes", function () {
    const dict = new Dict();
    dict.set("Width", 1);
    dict.set("Height", 1);
    dict.set("BitsPerComponent", 8);
    dict.set("ColorSpace", Name.get("DeviceGray"));
    dict.set("Filter", Name.get("DCTDecode"));
    const stream = new Stream(jpeg, 0, jpeg.length, dict);
    const raw = extract(
      makeImage(Name.get("DeviceCMYK"), {
        SMask: new JpegStream(stream, jpeg.length, null),
      })
    );
    expect(raw.eligible).toBeTrue();
    expect(raw.bytes).toEqual(jpeg);
    expect(raw.softMask.bytes).toEqual(jpeg);
    expect(raw.softMask.filters).toEqual(["DCTDecode"]);
  });

  it("keeps unsupported soft-mask forms on the raster path", function () {
    const dict = new Dict();
    dict.set("Subtype", Name.get("Form"));
    const raw = extract(
      makeImage(Name.get("DeviceCMYK"), {
        SMask: new Stream(new Uint8Array(0), 0, 0, dict),
      })
    );
    expect(raw.eligible).toBeFalse();
    expect(raw.reason).toBe("UNSUPPORTED_MASK_COMPOSITING");
    expect(raw.bytes).toBeNull();
    expect(raw.softMask.reason).toBe("UNSUPPORTED_COMPOSITING");
  });
});
