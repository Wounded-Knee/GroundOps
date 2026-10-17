import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aestheticAddress } from "./aestheticAddress.js";

describe("aesthetic address", () => {
  it("uses the suggestion name and detail when both are present", () => {
    assert.deepEqual(
      aestheticAddress({
        label: "Denny's, 123 Main St, Springfield, IL, USA",
        name: "Denny's",
        detail: "123 Main St, Springfield, IL, USA",
      }),
      { title: "Denny's", subtitle: "123 Main St, Springfield, IL, USA" },
    );
  });

  it("splits a stored label on the first comma", () => {
    assert.deepEqual(aestheticAddress({ label: "Denny's, 123 Main St, Springfield", name: "Denny's, 123 Main St, Springfield", detail: "" }), {
      title: "Denny's",
      subtitle: "123 Main St, Springfield",
    });
    assert.deepEqual(aestheticAddress({ label: "Library", name: "Library", detail: "" }), {
      title: "Library",
      subtitle: "",
    });
  });
});
