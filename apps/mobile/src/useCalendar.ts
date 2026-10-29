import type { AvailabilityInterval, Sortie, SortieWriteRequest } from "@groundops/contracts";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AppState } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { readCalendarCache, writeCalendarCache } from "./calendarCache";
import { ensureCurrentDriver, requestCalendar } from "./calendarClient";
import { saveSortieDraft } from "./saveSortie";
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
    const cached = await readCalendarCache(userId);
    if (generation.current !== current) {
      return;
    }
    setScreen((prev) => ({
      ...prev,
      scope,
      anchor,
      sorties: cached?.sorties ?? [],
      availability: cached?.availability ?? [],
      live: false,
      message: cached ? couldNotRefresh : couldNotLoad,
      dialog: null,
    }));
  }

  async function load(scope: CalendarScope, anchor: Date, current: number): Promise<void> {
    const range = visibleRange(scope, anchor);
    void readCalendarCache(userId).then((cached) => {
      if (generation.current !== current || !cached) {
        return;
      }
      setScreen((prev) =>
        prev.live || prev.message ? prev : { ...prev, sorties: cached.sorties, availability: cached.availability },
      );
    });

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
    if (generation.current !== current) {
      return;
    }
    setScreen((prev) => ({
      ...prev,
      scope,
      anchor,
      sorties: calendar.sorties,
      availability: calendar.availability,
      live: true,
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
    if (!ready.live || saving.current) {
      if (!saving.current) {
        clearHeldRef.current();
        if (!ready.live) {
          setScreen((prev) => (prev.message ? prev : { ...prev, message: notSaved }));
        }
      }
      return;
    }
    saving.current = true;
    const current = generation.current;
    const saved = await saveSortieDraft(apiUrl, token, sortieId, body);
    saving.current = false;
    if (saved === "unauthorized") {
      clearHeldRef.current();
      onUnauthorizedRef.current();
      return;
    }
    if (saved === "no-location") {
      clearHeldRef.current();
      setScreen((prev) => ({ ...prev, message: locationRequired }));
      return;
    }
    if (saved === "not-saved") {
      clearHeldRef.current();
      setScreen((prev) => ({ ...prev, message: notSaved }));
      return;
    }

    closeDialogChromeRef.current();
    setScreen((prev) => ({ ...prev, dialog: null, message: null }));

    if (generation.current !== current) {
      clearHeldRef.current();
      return;
    }

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
      setScreen((prev) => ({ ...prev, live: false, message: couldNotRefresh }));
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
    clearHeldRef.current();
    setScreen((prev) => ({
      ...prev,
      sorties: calendar.sorties,
      availability: calendar.availability,
      live: true,
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
      if (state !== "active" || !shown.current.live) {
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
