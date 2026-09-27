import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateSessionResponse } from "@groundops/contracts";
import type { GoogleIdentity } from "./google.js";
import { signInWithGoogle } from "./sign-in.js";

describe("sign in", () => {
  it("does not write a user when Google verification fails", async () => {
    let writes = 0;
    const result = await signInWithGoogle(
      "rejected-token",
      async () => null,
      async (_identity: GoogleIdentity): Promise<CreateSessionResponse> => {
        writes += 1;
        throw new Error("persist should not run");
      },
    );

    assert.equal(result, "rejected");
    assert.equal(writes, 0);
  });
});
