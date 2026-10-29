import type { RealtimeEnvelope } from "@groundops/contracts";
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { readActivity } from "./calendarClient";
import {
  applyEnvelope,
  applySnapshot,
  emptyActivity,
  readRealtimeEnvelope,
  type AccountActivity,
} from "./liveActivity";
import type { SocketState } from "./networkStatus";
import { openAuthenticatedSocket, readCurrentUser } from "./sessionClient";
import { deliverAvailabilityEnvelope } from "./availability";

export function useAccountActivity(input: {
  apiUrl: string;
  sessionToken: string | null;
  generation: MutableRefObject<number>;
  onSessionRejected: () => Promise<void>;
  onCalendarChanged: () => void;
  setLive: (token: string, live: "authenticated" | "closed") => void;
}): {
  activity: AccountActivity;
  setActivity: Dispatch<SetStateAction<AccountActivity>>;
  socketLink: SocketState;
} {
  const { apiUrl, sessionToken, generation } = input;
  const onSessionRejectedRef = useRef(input.onSessionRejected);
  const onCalendarChangedRef = useRef(input.onCalendarChanged);
  const setLiveRef = useRef(input.setLive);
  onSessionRejectedRef.current = input.onSessionRejected;
  onCalendarChangedRef.current = input.onCalendarChanged;
  setLiveRef.current = input.setLive;
  const [activity, setActivity] = useState<AccountActivity>(emptyActivity);
  const [socketLink, setSocketLink] = useState<SocketState>("idle");

  useEffect(() => {
    if (!sessionToken) {
      setSocketLink("idle");
      return;
    }

    const token = sessionToken;
    setSocketLink("connecting");
    const effectGeneration = generation.current;
    let cancelled = false;
    let connection = 0;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let ready = false;
    let buffer: RealtimeEnvelope[] = [];
    let state = emptyActivity;

    const connect = () => {
      if (cancelled || generation.current !== effectGeneration) {
        return;
      }
      const connectionId = ++connection;
      ready = false;
      buffer = [];
      socket = openAuthenticatedSocket(apiUrl, token);

      socket.onopen = () => {
        if (cancelled || connectionId !== connection || generation.current !== effectGeneration) {
          return;
        }
        attempt = 0;
        setSocketLink("open");
        setLiveRef.current(token, "authenticated");
        void loadSnapshot(connectionId);
      };

      socket.onmessage = (event) => {
        if (cancelled || connectionId !== connection || generation.current !== effectGeneration) {
          return;
        }
        const envelope = readRealtimeEnvelope(readJson(typeof event.data === "string" ? event.data : ""));
        if (!envelope) {
          return;
        }
        if (envelope.type === "availability.updated") {
          deliverAvailabilityEnvelope(envelope);
          return;
        }
        if (!ready) {
          buffer.push(envelope);
          return;
        }
        const applied = applyEnvelope(state, envelope);
        state = applied.state;
        setActivity(state);
        if (applied.calendarChanged) {
          onCalendarChangedRef.current();
        }
      };

      socket.onclose = () => {
        if (cancelled || connectionId !== connection || generation.current !== effectGeneration) {
          return;
        }
        void handleClose();
      };
    };

    async function loadSnapshot(connectionId: number): Promise<void> {
      const snapshot = await readActivity(apiUrl, token);
      if (cancelled || connectionId !== connection || generation.current !== effectGeneration) {
        return;
      }
      if (snapshot === "unauthorized") {
        await onSessionRejectedRef.current();
        return;
      }
      if (snapshot !== "unreachable") {
        state = applySnapshot(snapshot);
      }
      ready = true;
      let calendarChanged = false;
      for (const envelope of buffer) {
        if (envelope.type === "availability.updated") {
          deliverAvailabilityEnvelope(envelope);
          continue;
        }
        const applied = applyEnvelope(state, envelope);
        state = applied.state;
        calendarChanged = calendarChanged || applied.calendarChanged;
      }
      buffer = [];
      setActivity(state);
      if (calendarChanged) {
        onCalendarChangedRef.current();
      }
    }

    async function handleClose(): Promise<void> {
      const current = await readCurrentUser(apiUrl, token);
      if (cancelled || generation.current !== effectGeneration) {
        return;
      }
      if (current === "unauthorized") {
        await onSessionRejectedRef.current();
        return;
      }
      setSocketLink("down");
      setLiveRef.current(token, "closed");
      const delay = Math.min(15000, 1000 * 2 ** attempt);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    }

    connect();
    return () => {
      cancelled = true;
      generation.current += 1;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      socket?.close();
    };
  }, [apiUrl, generation, sessionToken]);

  return { activity, setActivity, socketLink };
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
