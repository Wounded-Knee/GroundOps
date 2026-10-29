import type { Sortie } from "@groundops/contracts";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { requestCalendar } from "./calendarClient";
import { cancelDepartureAlerts, scheduleDepartureAlerts } from "./departureAlerts";
import { nextDeparture, type NextDeparture } from "./nextDeparture";

export function useUpcomingDeparture(input: {
  apiUrl: string;
  token: string;
  browsing: boolean;
  onUnauthorized: () => void;
}): { upcoming: NextDeparture | null; clock: number } {
  const { apiUrl, token, browsing, onUnauthorized } = input;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const [upcomingSorties, setUpcomingSorties] = useState<Sortie[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  const upcoming = browsing ? nextDeparture(upcomingSorties, new Date(clock)) : null;
  const upcomingRef = useRef(upcoming);
  upcomingRef.current = upcoming;

  useEffect(() => {
    if (!browsing) {
      return;
    }
    let cancelled = false;
    async function loadUpcoming(): Promise<void> {
      const from = new Date();
      const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
      const result = await requestCalendar(apiUrl, token, from.toISOString(), to.toISOString());
      if (cancelled) {
        return;
      }
      if (result === "unauthorized") {
        onUnauthorizedRef.current();
        return;
      }
      if (typeof result === "string") {
        return;
      }
      setUpcomingSorties(result.sorties);
    }
    void loadUpcoming();
    const poll = setInterval(() => {
      void loadUpcoming();
    }, 60_000);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void loadUpcoming();
      }
    });
    return () => {
      cancelled = true;
      clearInterval(poll);
      appState.remove();
    };
  }, [apiUrl, browsing, token]);

  useEffect(() => {
    if (!browsing) {
      return;
    }
    const tick = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [browsing]);

  useEffect(() => {
    const syncAlerts = (state: string): void => {
      if (state === "active") {
        void cancelDepartureAlerts();
        return;
      }
      void scheduleDepartureAlerts(upcomingRef.current, new Date());
    };
    syncAlerts(AppState.currentState);
    const sub = AppState.addEventListener("change", syncAlerts);
    return () => {
      sub.remove();
      void cancelDepartureAlerts();
    };
  }, []);

  const upcomingDepartAt = upcoming?.departAt.getTime() ?? null;
  useEffect(() => {
    if (AppState.currentState === "active") {
      return;
    }
    void scheduleDepartureAlerts(upcoming, new Date());
  }, [upcoming?.sortieId, upcomingDepartAt]);

  return { upcoming, clock };
}
