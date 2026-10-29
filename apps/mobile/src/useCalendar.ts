import type { AvailabilityInterval, Sortie, SortieWriteRequest } from "@groundops/contracts";
import * as Location from "expo-location";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AppState } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { readCalendarCache, writeCalendarCache } from "./calendarCache";
import { ensureCurrentDriver, requestCalendar } from "./calendarClient";
import { readPending, saveOrQueueSortie } from "./pendingSorties";
import { overlaySorties, rangeCovers } from "./provisionalWindow";
import type { DialogDraft } from "./SortieDialog";
import { visibleRange, type CalendarScope } from "./calendarTime";

const couldNotLoad = "The calendar could not be loaded.";
const couldNotRefresh = "The calendar could not be refreshed.";
const notSaved = "The sortie was not saved.";
const locationRequired = "Location is required to schedule the sortie.";
const apiUrl = resolveApiUrl();

export type CalendarReady = {
  status: "ready";
  scope: CalendarScope;
  anchor: Date;
  sorties: Sortie[];
  availability: AvailabilityInterval[];
  live: boolean;
  pendingIds: string[];
  message: string | null;
  dialog: DialogDraft | null;
};

function emptyCalendar(anchor: Date): CalendarReady {
  return {
    status: "ready",
    scope: "day",
    anchor,
    sorties: [],
    availability: [],
    live: false,
    pendingIds: [],
    message: null,
    dialog: null,
  };
}

export function useCalendar(input: {
  userId: string;
  token: string;
  reloadToken: number;
  onUnauthorized: () => void;
  clearHeld: () => void;
  closeDialogChrome: () => void;
}): {
  screen: CalendarReady;
  setScreen: Dispatch<SetStateAction<CalendarReady>>;
  showPeriod: (scope: CalendarScope, anchor: Date) => void;
  commit: (ready: CalendarReady, sortieId: string | null, body: SortieWriteRequest) => Promise<void>;
} {
  const { userId, token, reloadToken } = input;
  const onUnauthorizedRef = useRef(input.onUnauthorized);
  const clearHeldRef = useRef(input.clearHeld);
  const closeDialogChromeRef = useRef(input.closeDialogChrome);
  onUnauthorizedRef.current = input.onUnauthorized;
  clearHeldRef.current = input.clearHeld;
  closeDialogChromeRef.current = input.closeDialogChrome;
  const [screen, setScreen] = useState<CalendarReady>(() => emptyCalendar(new Date()));
  const generation = useRef(0);
  const saving = useRef(false);
  const shown = useRef({ scope: screen.scope, anchor: screen.anchor, live: screen.live });
  shown.current = { scope: screen.scope, anchor: screen.anchor, live: screen.live };

  async function showCached(scope: CalendarScope, anchor: Date, current: number): Promise<void> {
    const range = visibleRange(scope, anchor);
    const cached = await readCalendarCache(userId);
    const pending = await readPending(userId);
    if (generation.current !== current) {
      return;
    }
    const covered = cached !== null && rangeCovers(cached, range);
    setScreen((prev) => ({
      ...prev,
      scope,
      anchor,
      sorties: overlaySorties(covered && cached ? cached.sorties : [], pending.map((command) => command.provisional)),
      availability: covered && cached ? cached.availability : [],
      live: false,
      pendingIds: pending.map((command) => command.sortieId),
      message: covered ? couldNotRefresh : couldNotLoad,
      dialog: null,
    }));
  }

  async function paintCached(scope: CalendarScope, anchor: Date, current: number): Promise<void> {
    const range = visibleRange(scope, anchor);
    const cached = await readCalendarCache(userId);
    const pending = await readPending(userId);
    if (generation.current !== current) {
      return;
    }
    const covered = cached !== null && rangeCovers(cached, range);
    setScreen((prev) => {
      if (prev.live || prev.message) {
        return prev;
      }
      return {
        ...prev,
        scope,
        anchor,
        sorties: overlaySorties(covered && cached ? cached.sorties : [], pending.map((command) => command.provisional)),
        availability: covered && cached ? cached.availability : prev.availability,
        pendingIds: pending.map((command) => command.sortieId),
      };
    });
  }

  async function load(scope: CalendarScope, anchor: Date, current: number): Promise<void> {
    const range = visibleRange(scope, anchor);
    void paintCached(scope, anchor, current);

    const ensured = await ensureCurrentDriver(apiUrl, token);
    if (generation.current !== current) {
      return;
    }
    if (ensured === "unauthorized") {
      onUnauthorizedRef.current();
      return;
    }
    if (ensured === "unreachable") {
      await showCached(scope, anchor, current);
      return;
    }

    const calendar = await requestCalendar(apiUrl, token, range.from.toISOString(), range.to.toISOString());
    if (generation.current !== current) {
      return;
    }
    if (calendar === "unauthorized") {
      onUnauthorizedRef.current();
      return;
    }
    if (calendar === "unreachable" || calendar === "rejected") {
      await showCached(scope, anchor, current);
      return;
    }

    await writeCalendarCache({
      userId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      sorties: calendar.sorties,
      availability: calendar.availability,
    });
    const pending = await readPending(userId);
    if (generation.current !== current) {
      return;
    }
    setScreen((prev) => ({
      ...prev,
      scope,
      anchor,
      sorties: overlaySorties(calendar.sorties, pending.map((command) => command.provisional)),
      availability: calendar.availability,
      live: true,
      pendingIds: pending.map((command) => command.sortieId),
      message: saveFailureMessage(prev.message) ? prev.message : null,
      dialog: withFreshSortie(prev.dialog, calendar.sorties),
    }));
  }

  function showPeriod(scope: CalendarScope, anchor: Date): void {
    clearHeldRef.current();
    closeDialogChromeRef.current();
    const current = ++generation.current;
    setScreen((currentScreen) => ({
      ...currentScreen,
      scope,
      anchor,
      dialog: null,
      message: currentScreen.live ? null : currentScreen.message,
    }));
    void load(scope, anchor, current);
  }

  async function commit(ready: CalendarReady, sortieId: string | null, body: SortieWriteRequest): Promise<void> {
    if (saving.current) {
      return;
    }
    saving.current = true;
    const result = await saveOrQueueSortie({
      apiUrl,
      token,
      userId,
      sortieId,
      body,
      sorties: ready.sorties,
      gps: await currentFix(),
    });
    saving.current = false;
    if (result.status === "unauthorized") {
      clearHeldRef.current();
      onUnauthorizedRef.current();
      return;
    }
    if (result.status === "no-location") {
      clearHeldRef.current();
      setScreen((prev) => ({ ...prev, message: locationRequired }));
      return;
    }
    if (result.status === "not-saved") {
      clearHeldRef.current();
      setScreen((prev) => ({ ...prev, message: notSaved }));
      return;
    }
    if (result.status === "queued") {
      const pending = await readPending(userId);
      closeDialogChromeRef.current();
      clearHeldRef.current();
      setScreen((prev) => ({
        ...prev,
        dialog: null,
        sorties: overlaySorties(
          prev.sorties.filter((sortie) => !pending.some((command) => command.sortieId === sortie.id)),
          pending.map((command) => command.provisional),
        ),
        pendingIds: pending.map((command) => command.sortieId),
        message: null,
      }));
      return;
    }

    const saved = result.sortie;
    closeDialogChromeRef.current();
    setScreen((prev) => ({ ...prev, dialog: null, message: null }));
    const current = generation.current;
    const range = visibleRange(ready.scope, ready.anchor);
    const calendar = await requestCalendar(apiUrl, token, range.from.toISOString(), range.to.toISOString());
    if (generation.current !== current) {
      clearHeldRef.current();
      return;
    }
    if (calendar === "unauthorized") {
      clearHeldRef.current();
      onUnauthorizedRef.current();
      return;
    }
    if (typeof calendar === "string") {
      clearHeldRef.current();
      const remaining = await readPending(userId);
      setScreen((prev) => ({
        ...prev,
        sorties: overlaySorties(
          prev.sorties.filter((sortie) => sortie.id !== saved.id),
          [saved, ...remaining.map((command) => command.provisional)],
        ),
        live: false,
        pendingIds: remaining.map((command) => command.sortieId),
        message: couldNotRefresh,
      }));
      return;
    }
    await writeCalendarCache({
      userId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      sorties: calendar.sorties,
      availability: calendar.availability,
    });
    if (generation.current !== current) {
      clearHeldRef.current();
      return;
    }
    const remaining = await readPending(userId);
    clearHeldRef.current();
    setScreen((prev) => ({
      ...prev,
      sorties: overlaySorties(calendar.sorties, remaining.map((command) => command.provisional)),
      availability: calendar.availability,
      live: true,
      pendingIds: remaining.map((command) => command.sortieId),
      message: prev.dialog ? prev.message : null,
    }));
  }

  useEffect(() => {
    const current = ++generation.current;
    void load("day", new Date(), current);
  }, [token, userId]);

  useEffect(() => {
    if (reloadToken === 0) {
      return;
    }
    const current = ++generation.current;
    void load(shown.current.scope, shown.current.anchor, current);
  }, [reloadToken]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        return;
      }
      const current = ++generation.current;
      void load(shown.current.scope, shown.current.anchor, current);
    });
    return () => sub.remove();
  }, [token, userId]);

  return { screen, setScreen, showPeriod, commit };
}

function saveFailureMessage(message: string | null): boolean {
  return message === notSaved || message === locationRequired;
}

async function currentFix(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status !== "granted") {
      return null;
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    return null;
  }
}

function withFreshSortie(dialog: DialogDraft | null, sorties: Sortie[]): DialogDraft | null {
  if (!dialog?.sortie) {
    return dialog;
  }
  const fresh = sorties.find((item) => item.id === dialog.sortie?.id);
  if (!fresh || fresh === dialog.sortie) {
    return dialog;
  }
  return { ...dialog, sortie: fresh };
}
