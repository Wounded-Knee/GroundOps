import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliverEnvelope, sessionMayHoldSocket, socketOpen } from "./gateway.js";

describe("gateway audience", () => {
  it("delivers an envelope only to open sockets for that user", () => {
    const sent: Record<string, string[]> = { a: [], b: [] };
    deliverEnvelope(
      [
        { userId: "a", readyState: socketOpen, send: (data) => sent.a?.push(data) },
        { userId: "b", readyState: socketOpen, send: (data) => sent.b?.push(data) },
        { userId: "a", readyState: 3, send: (data) => sent.a?.push(data) },
      ],
      { userId: "a" },
      "{\"type\":\"location.updated\"}",
    );
    assert.deepEqual(sent.a, ["{\"type\":\"location.updated\"}"]);
    assert.deepEqual(sent.b, []);
  });

  it("does not keep a socket when the session is missing or revoked", () => {
    assert.equal(sessionMayHoldSocket(null, socketOpen), false);
    assert.equal(sessionMayHoldSocket({ sessionId: "s" }, 3), false);
    assert.equal(sessionMayHoldSocket({ sessionId: "s" }, socketOpen), true);
  });
});
