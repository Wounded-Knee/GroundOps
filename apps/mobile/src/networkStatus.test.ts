import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyHealthResponse,
  deviceInternet,
  observeNetwork,
  visibleFault,
  type NetworkSignals,
  type SocketState,
} from "./networkStatus";

const body = { ok: true, postgres: "up", nats: "up" };
const sick = { ok: false, postgres: "down", nats: "up" };

function picture(
  patch: Partial<NetworkSignals> & Pick<NetworkSignals, "internet" | "api" | "health" | "socket">,
): NetworkSignals {
  return patch;
}

describe("device internet", () => {
  it("uses the browser online flag and ignores the native reachability bits", () => {
    assert.equal(deviceInternet({ platform: "web", webOnline: false, isConnected: true }), "down");
    assert.equal(deviceInternet({ platform: "web", webOnline: true, isConnected: false }), "up");
    assert.equal(deviceInternet({ platform: "web", webOnline: null }), "unknown");
  });

  it("treats a missing native connection or a failed reachability check as offline", () => {
    assert.equal(deviceInternet({ platform: "native", isConnected: false, isInternetReachable: true }), "down");
    assert.equal(deviceInternet({ platform: "native", isConnected: true, isInternetReachable: false }), "down");
    assert.equal(deviceInternet({ platform: "native", isConnected: true, isInternetReachable: true }), "up");
    assert.equal(deviceInternet({ platform: "native", isConnected: true }), "up");
    assert.equal(deviceInternet({ platform: "native" }), "unknown");
  });
});

describe("health response", () => {
  it("accepts only HTTP 200 with ok true", () => {
    assert.equal(classifyHealthResponse(200, body), "healthy");
    assert.equal(classifyHealthResponse(503, sick), "unhealthy");
    assert.equal(classifyHealthResponse(200, sick), "unhealthy");
    assert.equal(classifyHealthResponse(502, undefined), "unhealthy");
  });
});

describe("visible fault", () => {
  it("shows nothing while a check is still unknown", () => {
    assert.equal(
      visibleFault(picture({ internet: "unknown", api: "unknown", health: "unknown", socket: "connecting" })),
      null,
    );
    assert.equal(
      visibleFault(picture({ internet: "up", api: "unknown", health: "unknown", socket: "connecting" })),
      null,
    );
    assert.equal(
      visibleFault(picture({ internet: "up", api: "unknown", health: "down", socket: "idle" })),
      null,
    );
  });

  it("shows only internet when the device is offline, even if the server also looks down", () => {
    assert.equal(
      visibleFault(picture({ internet: "down", api: "down", health: "down", socket: "down" })),
      "internet",
    );
  });

  it("shows only the API when the socket or the probe is down and hides health", () => {
    assert.equal(
      visibleFault(picture({ internet: "up", api: "up", health: "down", socket: "down" })),
      "api",
    );
    assert.equal(
      visibleFault(picture({ internet: "up", api: "down", health: "down", socket: "open" })),
      "api",
    );
    assert.equal(
      visibleFault(picture({ internet: "up", api: "down", health: "unknown", socket: "idle" })),
      "api",
    );
  });

  it("shows health when the server answered and the socket is not down", () => {
    for (const socket of ["idle", "open", "connecting"] as const satisfies readonly SocketState[]) {
      assert.equal(
        visibleFault(picture({ internet: "up", api: "up", health: "down", socket })),
        "health",
      );
    }
  });

  it("shows nothing when the probe is healthy and the socket is idle or open", () => {
    assert.equal(
      visibleFault(picture({ internet: "up", api: "up", health: "up", socket: "idle" })),
      null,
    );
    assert.equal(
      visibleFault(picture({ internet: "up", api: "up", health: "up", socket: "open" })),
      null,
    );
  });
});

describe("observed signals", () => {
  it("drops API and health results while the device is offline", () => {
    assert.deepEqual(
      observeNetwork({ device: "down", probe: "unhealthy", internetConfirmed: null, socket: "down" }),
      { internet: "down", api: "unknown", health: "unknown", socket: "down" },
    );
    assert.equal(
      visibleFault(observeNetwork({ device: "down", probe: "unhealthy", internetConfirmed: null, socket: "down" })),
      "internet",
    );
  });

  it("treats a 503 body as server health once the device is online", () => {
    const signals = observeNetwork({
      device: "up",
      probe: classifyHealthResponse(503, sick),
      internetConfirmed: null,
      socket: "open",
    });
    assert.deepEqual(signals, { internet: "up", api: "up", health: "down", socket: "open" });
    assert.equal(visibleFault(signals), "health");
  });

  it("hides a failed probe until a connectivity check confirms the internet", () => {
    assert.equal(
      visibleFault(
        observeNetwork({ device: "up", probe: "unreachable", internetConfirmed: null, socket: "down" }),
      ),
      null,
    );
    assert.equal(
      visibleFault(
        observeNetwork({ device: "up", probe: "unreachable", internetConfirmed: false, socket: "down" }),
      ),
      "internet",
    );
    assert.equal(
      visibleFault(
        observeNetwork({ device: "up", probe: "unreachable", internetConfirmed: true, socket: "idle" }),
      ),
      "api",
    );
  });

  it("shows nothing for a healthy response with an idle or open socket", () => {
    assert.equal(
      visibleFault(
        observeNetwork({
          device: "up",
          probe: classifyHealthResponse(200, body),
          internetConfirmed: null,
          socket: "idle",
        }),
      ),
      null,
    );
    assert.equal(
      visibleFault(
        observeNetwork({
          device: "unknown",
          probe: classifyHealthResponse(200, body),
          internetConfirmed: null,
          socket: "open",
        }),
      ),
      null,
    );
  });

  it("lets a down socket hide a healthy or unhealthy server", () => {
    assert.equal(
      visibleFault(
        observeNetwork({
          device: "up",
          probe: classifyHealthResponse(200, body),
          internetConfirmed: null,
          socket: "down",
        }),
      ),
      "api",
    );
    assert.equal(
      visibleFault(
        observeNetwork({
          device: "up",
          probe: classifyHealthResponse(503, sick),
          internetConfirmed: null,
          socket: "down",
        }),
      ),
      "api",
    );
  });
});
