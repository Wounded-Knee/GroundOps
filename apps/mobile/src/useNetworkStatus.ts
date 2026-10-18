import { useNetworkState } from "expo-network";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  classifyHealthResponse,
  deviceInternet,
  observeNetwork,
  visibleFault,
  type NetworkFault,
  type ProbeOutcome,
  type SocketState,
} from "./networkStatus";

const pollMs = 15_000;
const probeTimeoutMs = 5_000;
const internetCheckUrl = "https://cp.cloudflare.com/generate_204";

type Sample = {
  probe: ProbeOutcome;
  internetConfirmed: boolean | null;
};

export function useNetworkStatus(apiUrl: string, socket: SocketState): NetworkFault | null {
  const native = useNetworkState();
  const [webOnline, setWebOnline] = useState(initialWebOnline);
  const [sample, setSample] = useState<Sample>({ probe: "pending", internetConfirmed: null });
  const apiUrlRef = useRef(apiUrl);
  apiUrlRef.current = apiUrl;

  const device = deviceInternet({
    platform: Platform.OS === "web" ? "web" : "native",
    isConnected: native.isConnected,
    isInternetReachable: native.isInternetReachable,
    webOnline,
  });
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const offline = device === "down";

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return;
    }
    const update = () => {
      setWebOnline(window.navigator.onLine);
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (offline) {
      setSample({ probe: "pending", internetConfirmed: null });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let generation = 0;
    let currentAbort = new AbortController();

    const forget = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const arm = () => {
      forget();
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, pollMs);
    };

    const run = async () => {
      if (cancelled) {
        return;
      }
      const started = deviceRef.current;
      if (started === "down") {
        return;
      }
      forget();
      currentAbort.abort();
      currentAbort = new AbortController();
      const signal = currentAbort.signal;
      const id = ++generation;
      const outcome = await readService(apiUrlRef.current, signal);
      const finished = deviceRef.current;
      if (cancelled || id !== generation || signal.aborted || finished === "down") {
        if (!cancelled && finished === "down") {
          setSample({ probe: "pending", internetConfirmed: null });
        }
        return;
      }
      if (outcome.probe === "pending") {
        return;
      }
      setSample(outcome);
      arm();
    };

    void run();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void run();
      }
    });

    return () => {
      cancelled = true;
      currentAbort.abort();
      forget();
      subscription.remove();
    };
  }, [offline]);

  const shown = offline ? { probe: "pending" as const, internetConfirmed: null } : sample;
  return visibleFault(
    observeNetwork({
      device,
      probe: shown.probe,
      internetConfirmed: shown.internetConfirmed,
      socket,
    }),
  );
}

function initialWebOnline(): boolean | null {
  if (Platform.OS !== "web" || typeof navigator === "undefined") {
    return null;
  }
  return navigator.onLine;
}

async function readService(apiUrl: string, signal: AbortSignal): Promise<Sample> {
  const timed = abortAfter(signal, probeTimeoutMs);
  try {
    const response = await fetch(`${apiUrl}/health`, { signal: timed.signal });
    return { probe: classifyHealthResponse(response.status, await readJson(response)), internetConfirmed: null };
  } catch {
    if (signal.aborted) {
      return { probe: "pending", internetConfirmed: null };
    }
    if (Platform.OS === "web") {
      return { probe: "unreachable", internetConfirmed: true };
    }
    const internetConfirmed = await confirmInternet(signal);
    if (internetConfirmed === null) {
      return { probe: "pending", internetConfirmed: null };
    }
    return { probe: "unreachable", internetConfirmed };
  } finally {
    timed.done();
  }
}

async function confirmInternet(signal: AbortSignal): Promise<boolean | null> {
  if (signal.aborted) {
    return null;
  }
  const timed = abortAfter(signal, probeTimeoutMs);
  try {
    const response = await fetch(internetCheckUrl, { signal: timed.signal });
    return response.status === 204 || response.ok;
  } catch {
    if (signal.aborted) {
      return null;
    }
    return false;
  } finally {
    timed.done();
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function abortAfter(parent: AbortSignal, ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onParent = () => {
    clearTimeout(timer);
    controller.abort();
  };
  if (!parent.aborted) {
    parent.addEventListener("abort", onParent);
  } else {
    onParent();
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
  };
}
