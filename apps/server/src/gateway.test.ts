import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliverEnvelope, readHandshakeToken, sessionMayHoldSocket, socketOpen } from "./gateway.js";

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

  it("delivers availability only to that driver's open sockets", () => {
    const sent: Record<string, string[]> = { a: [], b: [] };
    deliverEnvelope(
      [
        { userId: "a", readyState: socketOpen, send: (data) => sent.a?.push(data) },
        { userId: "b", readyState: socketOpen, send: (data) => sent.b?.push(data) },
      ],
      { userId: "a" },
      "{\"type\":\"availability.updated\"}",
    );
    assert.deepEqual(sent.a, ["{\"type\":\"availability.updated\"}"]);
    assert.deepEqual(sent.b, []);
  });

  it("reads the session token from the bearer header or the web protocol list", () => {
    assert.equal(readHandshakeToken("Bearer header-token", "bearer, protocol-token"), "header-token");
    assert.equal(readHandshakeToken(undefined, "bearer, protocol-token"), "protocol-token");
    assert.equal(readHandshakeToken(undefined, "bearer"), null);
    assert.equal(readHandshakeToken(undefined, undefined), null);
  });

  it("does not keep a socket when the session is missing or revoked", () => {
    assert.equal(sessionMayHoldSocket(null, socketOpen), false);
    assert.equal(sessionMayHoldSocket({ sessionId: "s" }, 3), false);
    assert.equal(sessionMayHoldSocket({ sessionId: "s" }, socketOpen), true);
  });
});
