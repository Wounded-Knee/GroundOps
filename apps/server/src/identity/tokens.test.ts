import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashSessionToken, newSessionToken, readBearer } from "./tokens.js";

describe("session tokens", () => {
  it("hashes the token with sha-256", () => {
    assert.equal(
      hashSessionToken("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("issues an unguessable token", () => {
    const token = newSessionToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(token, newSessionToken());
  });
});

describe("bearer credentials", () => {
  it("reads a single bearer token", () => {
    assert.equal(readBearer("Bearer session-token"), "session-token");
  });

  it("rejects missing, empty, and non-bearer headers", () => {
    assert.equal(readBearer(undefined), null);
    assert.equal(readBearer("Bearer "), null);
    assert.equal(readBearer("Bearer a b"), null);
    assert.equal(readBearer("bearer session-token"), null);
    assert.equal(readBearer("Token session-token"), null);
  });
});
