import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { registerLocalCors } from "./cors.js";

describe("local cors", () => {
  it("allows a localhost web origin and rejects another origin", async () => {
    const app = Fastify();
    registerLocalCors(app);
    app.get("/health", async () => ({ ok: true }));

    const local = await app.inject({
      method: "OPTIONS",
      url: "/me",
      headers: {
        origin: "http://localhost:8081",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    assert.equal(local.statusCode, 204);
    assert.equal(local.headers["access-control-allow-origin"], "http://localhost:8081");
    assert.equal(local.headers["access-control-allow-headers"], "authorization, content-type");

    const remote = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://example.com" },
    });
    assert.equal(remote.headers["access-control-allow-origin"], undefined);
    await app.close();
  });
});
