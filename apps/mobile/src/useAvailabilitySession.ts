import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyAvailabilityEnvelope,
  applyAvailabilitySnapshot,
  availabilityCheckInMs,
  emptyAvailability,
  subscribeAvailability,
  type AvailabilityEnvelope,
  type AvailabilityView,
} from "./availability";
import { checkInAvailability, putAvailability, readAvailability } from "./availabilityClient";
import { recordAvailabilityCheckIn } from "./availabilityKeepalive";

export function useAvailabilitySession(input: {
  apiUrl: string;
  sessionToken: string | null;
  onSessionRejected: () => Promise<void>;
  onCalendarChanged: () => void;
}): {
  availability: AvailabilityView;
  availabilityLoaded: boolean;
  availabilityBusy: boolean;
  availabilityMessage: string | null;
  toggleAvailability: () => void;
} {
  const { apiUrl, sessionToken } = input;
  const onSessionRejectedRef = useRef(input.onSessionRejected);
  const onCalendarChangedRef = useRef(input.onCalendarChanged);
  onSessionRejectedRef.current = input.onSessionRejected;
  onCalendarChangedRef.current = input.onCalendarChanged;
  const [availability, setAvailability] = useState<AvailabilityView>(emptyAvailability);
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);
  const toggleAvailabilityRef = useRef<() => void>(() => undefined);
  const toggleAvailability = useCallback(() => {
    toggleAvailabilityRef.current();
  }, []);

  useEffect(() => {
    if (!sessionToken) {
      setAvailability(emptyAvailability);
      setAvailabilityLoaded(false);
      setAvailabilityBusy(false);
      setAvailabilityMessage(null);
      toggleAvailabilityRef.current = () => undefined;
      return;
    }

    const token = sessionToken;
    let cancelled = false;
    let loaded = false;
    let saving = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const pending: AvailabilityEnvelope[] = [];
    const view = { ...emptyAvailability };

    function stopPings(): void {
      if (timer) {
        clearInterval(timer);
      }
      timer = null;
    }

    function startPings(): void {
      if (timer) {
        return;
      }
      timer = setInterval(() => {
        void ping();
      }, availabilityCheckInMs);
      void ping();
    }

    function remember(next: AvailabilityView): void {
      view.asOf = next.asOf;
      view.available = next.available;
      view.current = next.current;
      setAvailability({ ...view });
      if (next.available) {
        startPings();
      } else {
        stopPings();
      }
    }

    async function ping(): Promise<void> {
      const result = await checkInAvailability(apiUrl, token);
      if (cancelled) {
        return;
      }
      if (result === "unauthorized") {
        stopPings();
        await onSessionRejectedRef.current();
        return;
      }
      if (result === "unreachable") {
        return;
      }
      await recordAvailabilityCheckIn(Date.now());
      remember(applyAvailabilitySnapshot(view, result));
    }

    toggleAvailabilityRef.current = () => {
      if (!loaded || saving) {
        return;
      }
      saving = true;
      setAvailabilityBusy(true);
      setAvailabilityMessage(null);
      void (async () => {
        const result = await putAvailability(apiUrl, token, !view.available);
        if (cancelled) {
          return;
        }
        saving = false;
        setAvailabilityBusy(false);
        if (result === "unauthorized") {
          await onSessionRejectedRef.current();
          return;
        }
        if (result === "unreachable") {
          setAvailabilityMessage("Availability was not saved.");
          return;
        }
        remember(applyAvailabilitySnapshot(view, result));
      })();
    };

    function applyLive(envelope: AvailabilityEnvelope): void {
      const previous = view.current;
      const next = applyAvailabilityEnvelope(view, envelope);
      remember(next);
      if (next.current !== previous) {
        onCalendarChangedRef.current();
      }
    }

    const unsubscribe = subscribeAvailability((envelope) => {
      if (!loaded) {
        pending.push(envelope);
        return;
      }
      applyLive(envelope);
    });

    void (async () => {
      const result = await readAvailability(apiUrl, token);
      if (cancelled) {
        return;
      }
      if (result === "unauthorized") {
        await onSessionRejectedRef.current();
        return;
      }
      if (result === "unreachable") {
        setAvailabilityMessage("Availability could not be loaded.");
        return;
      }
      loaded = true;
      setAvailabilityLoaded(true);
      remember(result);
      for (const envelope of pending) {
        applyLive(envelope);
      }
      pending.length = 0;
    })();

    return () => {
      cancelled = true;
      stopPings();
      unsubscribe();
      toggleAvailabilityRef.current = () => undefined;
    };
  }, [apiUrl, sessionToken]);

  return { availability, availabilityLoaded, availabilityBusy, availabilityMessage, toggleAvailability };
}
