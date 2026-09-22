import { Dict, Name, Ref } from "../../src/core/primitives.js";
import { Catalog } from "../../src/core/catalog.js";
import { Stream } from "../../src/core/stream.js";

describe("output intents", function () {
  function createCatalog(intents = null) {
    const root = new Dict();
    root.set("Pages", new Dict());
    if (intents) {
      root.set("OutputIntents", intents);
    }
    const xref = {
      fetchIfRef(value) {
        return value;
      },
      getCatalogObj() {
        return root;
      },
    };
    return new Catalog({}, xref);
  }

  function profile({ valid = true, components = 4 } = {}) {
    const bytes = new Uint8Array(128);
    bytes[3] = 128;
    bytes.set([97, 99, 115, 112], 36); // acsp
    if (!valid) {
      bytes[3] = 127;
    }
    const dict = new Dict();
    dict.set("N", components);
    return new Stream(bytes, 0, bytes.length, dict);
  }

  function intent(subtype, destinationProfile = null) {
    const dict = new Dict();
    dict.set("S", Name.get(subtype));
    dict.set("OutputCondition", "Press condition");
    if (destinationProfile) {
      dict.set("DestOutputProfile", destinationProfile);
    }
    return dict;
  }

  it("returns an empty result when no output intents are present", function () {
    expect(createCatalog().outputIntents).toEqual({
      intents: [],
      selected: null,
    });
  });

  it("prefers GTS_PDFX and exposes its decoded profile", function () {
    const first = intent("GTS_PDFA1");
    const pdfx = intent("GTS_PDFX", profile());
    const result = createCatalog([first, pdfx]).outputIntents;
    expect(result.intents.length).toBe(2);
    expect(result.selected).toBe(result.intents[1]);
    expect(result.selected.subtype).toBe("GTS_PDFX");
    expect(result.selected.outputCondition).toBe("Press condition");
    expect(result.selected.profile).toEqual(profile().bytes);
  });

  it("resolves indirect output intents and destination profiles", function () {
    const outputIntentRef = Ref.get(10, 0);
    const profileRef = Ref.get(11, 0);
    const outputIntent = intent("GTS_PDFX", profileRef);
    const destinationProfile = profile();
    const root = new Dict();
    root.set("Pages", new Dict());
    root.set("OutputIntents", [outputIntentRef]);
    const objects = new Map([
      [outputIntentRef.toString(), outputIntent],
      [profileRef.toString(), destinationProfile],
    ]);
    const xref = {
      fetch(ref) {
        return objects.get(ref.toString());
      },
      fetchIfRef(value) {
        return value instanceof Ref ? this.fetch(value) : value;
      },
      getCatalogObj() {
        return root;
      },
    };
    root.xref = outputIntent.xref = xref;

    const result = new Catalog({}, xref).outputIntents;
    expect(result.selected.profile).toEqual(destinationProfile.bytes);
  });

  it("retains an intent but does not publish invalid profiles", function () {
    const result = createCatalog([
      intent("GTS_PDFX", profile({ valid: false })),
    ]).outputIntents;
    expect(result.selected.subtype).toBe("GTS_PDFX");
    expect(result.selected.profile).toBeNull();
  });

  it("does not publish profiles with unsupported component counts", function () {
    const result = createCatalog([
      intent("GTS_PDFX", profile({ components: 2 })),
    ]).outputIntents;
    expect(result.selected.profile).toBeNull();
  });
});
