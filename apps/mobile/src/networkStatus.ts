export type NetworkFault = "internet" | "api" | "health";

export type LinkState = "up" | "down" | "unknown";

/** `idle` when signed out. `connecting` before the first open or close. */
export type SocketState = "idle" | "connecting" | "open" | "down";

export type ProbeOutcome = "pending" | "unreachable" | "unhealthy" | "healthy";

export type NetworkSignals = {
  internet: LinkState;
  api: LinkState;
  health: LinkState;
  socket: SocketState;
};

export function deviceInternet(input: {
  platform: "web" | "native";
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
  webOnline?: boolean | null;
}): LinkState {
  if (input.platform === "web") {
    if (input.webOnline === true) {
      return "up";
    }
    if (input.webOnline === false) {
      return "down";
    }
    return "unknown";
  }
  if (input.isConnected === false || input.isInternetReachable === false) {
    return "down";
  }
  if (input.isConnected === true) {
    return "up";
  }
  return "unknown";
}

/** A completed HTTP response is reachability. Health is `ok: true` with status 200. */
export function classifyHealthResponse(status: number, body: unknown): "healthy" | "unhealthy" {
  if (status === 200 && isHealthOk(body)) {
    return "healthy";
  }
  return "unhealthy";
}

/**
 * Fold the device, the health probe, and the live socket into one picture.
 * A failed probe stays hidden until a connectivity check says the internet is up.
 * While the device is offline, API and health results are dropped.
 */
export function observeNetwork(input: {
  device: LinkState;
  probe: ProbeOutcome;
  internetConfirmed: boolean | null;
  socket: SocketState;
}): NetworkSignals {
  if (input.device === "down") {
    return { internet: "down", api: "unknown", health: "unknown", socket: input.socket };
  }
  if (input.probe === "healthy" || input.probe === "unhealthy") {
    return {
      internet: "up",
      api: "up",
      health: input.probe === "healthy" ? "up" : "down",
      socket: input.socket,
    };
  }
  if (input.probe === "unreachable") {
    if (input.internetConfirmed === false) {
      return { internet: "down", api: "unknown", health: "unknown", socket: input.socket };
    }
    if (input.internetConfirmed === true) {
      return { internet: "up", api: "down", health: "unknown", socket: input.socket };
    }
    return { internet: "unknown", api: "unknown", health: "unknown", socket: "idle" };
  }
  return { internet: input.device, api: "unknown", health: "unknown", socket: input.socket };
}

/** The furthest-upstream fault, or nothing when the chain is fine or still unknown. */
export function visibleFault(signals: NetworkSignals): NetworkFault | null {
  if (signals.internet === "down") {
    return "internet";
  }
  if (signals.internet !== "up") {
    return null;
  }
  if (signals.api === "down" || signals.socket === "down") {
    return "api";
  }
  const reachable = signals.api === "up" || signals.socket === "open";
  if (!reachable || signals.health !== "down") {
    return null;
  }
  return "health";
}

function isHealthOk(body: unknown): boolean {
  return typeof body === "object" && body !== null && "ok" in body && body.ok === true;
}
