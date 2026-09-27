import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readGoogleClientIds } from "./google.js";

describe("google client ids", () => {
  it("reads each configured platform and skips empty values", () => {
    const ids = readGoogleClientIds({
      GOOGLE_WEB_CLIENT_ID: "web-client",
      GOOGLE_ANDROID_CLIENT_ID: "",
      GOOGLE_IOS_CLIENT_ID: "ios-client",
    });
    assert.deepEqual(ids, ["web-client", "ios-client"]);
  });
});
