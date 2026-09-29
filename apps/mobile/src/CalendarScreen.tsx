import type { Sortie, SortieWriteRequest } from "@groundops/contracts";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { AppState, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { readCalendarCache, writeCalendarCache } from "./calendarCache";
import { authorSortie, ensureCurrentDriver, requestCalendar, requestTariff, reviseSortie } from "./calendarClient";
import {
  blockOnDay,
  calendarDayDelta,
  dayDeltaFromPixels,
  formatUsPhone,
  hourHeight,
  hourLabel,
  hourSlot,
  minuteDeltaFromPixels,
  monthGridDays,
  periodLabel,
  sameLocalDay,
  shiftAnchor,
  shiftArrival,
  visibleRange,
  weekDays,
  type CalendarScope,
} from "./calendarTime";
import type { SortieGuideCommand } from "./sortieGuide";
import { requestSortieDrivingRoute } from "./routingClient";
import { SortieDialog, emptyPlaces, placesFromSortie, sortieTitle, type DialogDraft } from "./SortieDialog";

const couldNotLoad = "The calendar could not be loaded.";
const couldNotRefresh = "The calendar could not be refreshed.";
const notSaved = "The sortie was not saved.";
const locationRequired = "Location is required to schedule the sortie.";
const routeFailed = "The route failed.";
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hours = Array.from({ length: 24 }, (_, hour) => hour);

const apiUrl = resolveApiUrl();

type Ready = {
  status: "ready";
  scope: CalendarScope;
  anchor: Date;
  sorties: Sortie[];
  live: boolean;
  message: string | null;
  dialog: DialogDraft | null;
  summary: Sortie | null;
};

function emptyCalendar(anchor: Date): Ready {
  return {
    status: "ready",
    scope: "month",
    anchor,
    sorties: [],
    live: false,
    message: null,
    dialog: null,
    summary: null,
  };
}

type GridBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  days: Date[];
};

export function CalendarScreen({
  userId,
  token,
  reloadToken = 0,
  onUnauthorized,
  onGuide,
}: {
  userId: string;
  token: string;
  reloadToken?: number;
  onUnauthorized: () => void;
  onGuide?: (command: SortieGuideCommand) => void;
}) {
  const [screen, setScreen] = useState<Ready>(() => emptyCalendar(new Date()));
  const generation = useRef(0);
  const saving = useRef(false);
  const gridRef = useRef<View>(null);
  const gridBox = useRef<GridBox | null>(null);
  const columnWidth = useRef(0);
  const hourScroll = useRef<ScrollView>(null);

  const shown = useRef({ scope: screen.scope, anchor: screen.anchor, live: screen.live });
  shown.current = { scope: screen.scope, anchor: screen.anchor, live: screen.live };

  useEffect(() => {
    const current = ++generation.current;
    void load("month", new Date(), current);
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

  async function load(scope: CalendarScope, anchor: Date, current: number): Promise<void> {
    const range = visibleRange(scope, anchor);
    void readCalendarCache(userId).then((cached) => {
      if (generation.current !== current || !cached) {
        return;
      }
      setScreen((prev) => (prev.live || prev.message ? prev : { ...prev, sorties: cached.sorties }));
    });

    const ensured = await ensureCurrentDriver(apiUrl, token);
    if (generation.current !== current) {
      return;
    }
    if (ensured === "unauthorized") {
      onUnauthorized();
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
      onUnauthorized();
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
    });
    if (generation.current !== current) {
      return;
    }
    setScreen((prev) => ({
      ...prev,
      scope,
      anchor,
      sorties: calendar.sorties,
      live: true,
      message: null,
      summary: prev.summary
        ? (calendar.sorties.find((item) => item.id === prev.summary?.id) ?? null)
        : null,
    }));
  }

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
      live: false,
      message: cached ? couldNotRefresh : couldNotLoad,
      dialog: null,
      summary: null,
    }));
  }

  function showPeriod(scope: CalendarScope, anchor: Date): void {
    const current = ++generation.current;
    setScreen((currentScreen) => ({
      ...currentScreen,
      scope,
      anchor,
      dialog: null,
      summary: null,
      message: currentScreen.live ? null : currentScreen.message,
    }));
    void load(scope, anchor, current);
  }

  async function commit(ready: Ready, sortieId: string | null, body: SortieWriteRequest): Promise<void> {
    if (!ready.live || saving.current) {
      return;
    }
    saving.current = true;
    const current = generation.current;
    const saved = sortieId
      ? await reviseSortie(apiUrl, token, sortieId, body)
      : await authorSortie(apiUrl, token, body);
    saving.current = false;
    if (generation.current !== current) {
      return;
    }
    if (saved === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (saved === "no-location") {
      setScreen({ ...ready, message: locationRequired });
      return;
    }
    if (typeof saved === "string") {
      setScreen({ ...ready, message: notSaved });
      return;
    }

    const range = visibleRange(ready.scope, ready.anchor);
    const calendar = await requestCalendar(apiUrl, token, range.from.toISOString(), range.to.toISOString());
    if (generation.current !== current) {
      return;
    }
    if (calendar === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (typeof calendar === "string") {
      setScreen({ ...ready, dialog: null, live: false, message: couldNotRefresh });
      return;
    }
    await writeCalendarCache({
      userId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      sorties: calendar.sorties,
    });
    setScreen({
      ...ready,
      sorties: calendar.sorties,
      live: true,
      message: null,
      dialog: null,
    });
  }

  function openDialog(ready: Ready, dialog: DialogDraft): void {
    if (!ready.live) {
      return;
    }
    setScreen({ ...ready, dialog, summary: null, message: null });
  }

  function openSummary(ready: Ready, sortie: Sortie): void {
    if (!ready.live) {
      return;
    }
    setScreen({ ...ready, summary: sortie, dialog: null, message: null });
  }

  async function guideSortie(ready: Ready, sortie: Sortie): Promise<void> {
    if (!onGuide || Platform.OS === "web") {
      return;
    }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      setScreen({ ...ready, summary: sortie, message: locationRequired });
      return;
    }
    let position: Location.LocationObject;
    try {
      position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
    } catch {
      setScreen({ ...ready, summary: sortie, message: locationRequired });
      return;
    }
    const origin = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    const tariffResult = await requestTariff(apiUrl, token);
    if (tariffResult === "unauthorized") {
      onUnauthorized();
      return;
    }
    const tariff = typeof tariffResult === "string" ? null : tariffResult;
    const route = await requestSortieDrivingRoute(apiUrl, token, sortie.id, origin, 0);
    if (route === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (route === "failed") {
      setScreen({ ...ready, summary: sortie, message: routeFailed });
      return;
    }
    setScreen({ ...ready, summary: null, message: null });
    onGuide({
      sortieId: sortie.id,
      stops: sortie.stops,
      firstStopPosition: 0,
      route,
      tariff,
    });
  }

  const ready = screen;
  const days = ready
    ? ready.scope === "month"
      ? monthGridDays(ready.anchor)
      : ready.scope === "week"
        ? weekDays(ready.anchor)
        : [startOfShownDay(ready.anchor)]
    : [];

  function captureGrid(): void {
    gridRef.current?.measureInWindow((x, y, width, height) => {
      if (!ready || ready.scope !== "month") {
        return;
      }
      gridBox.current = { x, y, width, height, days: monthGridDays(ready.anchor) };
    });
  }

  useEffect(() => {
    if (!ready || ready.scope === "month") {
      return;
    }
    hourScroll.current?.scrollTo({ y: 7 * hourHeight, animated: false });
  }, [ready?.scope, ready?.anchor]);

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
          <Text style={styles.period}>{periodLabel(ready.scope, ready.anchor)}</Text>
          <View style={styles.row}>
            {(["month", "week", "day"] as const).map((scope) => (
              <Pressable
                key={scope}
                onPress={() => showPeriod(scope, ready.anchor)}
                style={[styles.secondary, ready.scope === scope ? styles.selected : null]}
              >
                <Text style={styles.secondaryText}>{scopeLabel(scope)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable
              onPress={() => showPeriod(ready.scope, shiftAnchor(ready.scope, ready.anchor, -1))}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Previous</Text>
            </Pressable>
            <Pressable onPress={() => showPeriod(ready.scope, new Date())} style={styles.secondary}>
              <Text style={styles.secondaryText}>Today</Text>
            </Pressable>
            <Pressable
              onPress={() => showPeriod(ready.scope, shiftAnchor(ready.scope, ready.anchor, 1))}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Next</Text>
            </Pressable>
          </View>
          {ready.message ? <Text style={styles.message}>{ready.message}</Text> : null}
          {ready.scope === "month" ? (
            <ScrollView style={styles.gridScroll} onScroll={captureGrid} scrollEventThrottle={16}>
              <View style={styles.weekdays}>
                {weekdayLabels.map((label) => (
                  <Text key={label} style={styles.weekday}>
                    {label}
                  </Text>
                ))}
              </View>
              <View ref={gridRef} onLayout={captureGrid} style={styles.monthGrid}>
                {days.map((day) => {
                  const chips = ready.sorties.filter((sortie) => sameLocalDay(new Date(sortie.scheduledStart), day));
                  const inMonth = day.getMonth() === ready.anchor.getMonth();
                  const today = sameLocalDay(day, new Date());
                  return (
                    <View key={day.toDateString()} style={[styles.dayCell, today ? styles.today : null]}>
                      <Pressable onPress={() => showPeriod("day", day)} style={styles.dayHit} />
                      <Text
                        style={[
                          styles.dayNumber,
                          { pointerEvents: "none" },
                          inMonth ? null : styles.outside,
                          today ? styles.todayText : null,
                        ]}
                      >
                        {day.getDate()}
                      </Text>
                      {chips.map((sortie) => (
                        <MonthChip
                          key={sortie.id}
                          label={sortieTitle(sortie)}
                          enabled={ready.live && !ready.dialog && !ready.summary}
                          onOpen={() => openSummary(ready, sortie)}
                          onMove={(pageX, pageY) => {
                            const target = dayAtPoint(gridBox.current, pageX, pageY);
                            if (!target) {
                              return;
                            }
                            const arrival = shiftArrival(
                              new Date(sortie.arrivalAt),
                              calendarDayDelta(new Date(sortie.scheduledStart), target),
                              0,
                            );
                            if (!arrival) {
                              return;
                            }
                            void commit(ready, sortie.id, writeFrom(sortie, arrival));
                          }}
                        />
                      ))}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            <View style={styles.hourFrame}>
              <View style={styles.dayHeader}>
                <View style={styles.hourGutter} />
                {days.map((day) =>
                  ready.scope === "week" ? (
                    <Pressable key={day.toDateString()} onPress={() => showPeriod("day", day)} style={styles.dayHeading}>
                      <Text style={[styles.dayHeadingText, sameLocalDay(day, new Date()) ? styles.todayText : null]}>
                        {day.toLocaleDateString([], { weekday: "short", day: "numeric" })}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text
                      key={day.toDateString()}
                      style={[styles.dayHeading, styles.dayHeadingText, sameLocalDay(day, new Date()) ? styles.todayText : null]}
                    >
                      {day.toLocaleDateString([], { weekday: "short", day: "numeric" })}
                    </Text>
                  ),
                )}
              </View>
              <ScrollView ref={hourScroll} style={styles.gridScroll}>
                <View style={styles.hourRow}>
                  <View style={styles.hourGutter}>
                    {hours.map((hour) => (
                      <Text key={hour} style={styles.hourLabel}>
                        {hourLabel(hour)}
                      </Text>
                    ))}
                  </View>
                  {days.map((day) => (
                    <View
                      key={day.toDateString()}
                      style={styles.dayColumn}
                      onLayout={(event) => {
                        columnWidth.current = event.nativeEvent.layout.width;
                      }}
                    >
                      {hours.map((hour) => (
                        <Pressable
                          key={hour}
                          disabled={!ready.live || ready.dialog !== null || ready.summary !== null}
                          onPress={() => {
                            openDialog(ready, dialogForCreate(hourSlot(day, hour).start));
                          }}
                          style={styles.hourSlot}
                        />
                      ))}
                      {ready.sorties.map((sortie) => {
                        const start = new Date(sortie.scheduledStart);
                        const end = new Date(sortie.scheduledEnd);
                        const block = blockOnDay(start, end, day);
                        if (!block) {
                          return null;
                        }
                        return (
                          <HourBlock
                            key={sortie.id}
                            label={sortieTitle(sortie)}
                            top={block.top}
                            height={block.height}
                            enabled={ready.live && !ready.dialog && !ready.summary}
                            allowDayShift={ready.scope === "week"}
                            columnWidth={() => columnWidth.current}
                            onOpen={() => openSummary(ready, sortie)}
                            onMove={(dayDelta, minuteDelta) => {
                              const arrival = shiftArrival(new Date(sortie.arrivalAt), dayDelta, minuteDelta);
                              if (arrival) {
                                void commit(ready, sortie.id, writeFrom(sortie, arrival));
                              }
                            }}
                          />
                        );
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}
          {ready.live && !ready.dialog && !ready.summary ? (
            <Pressable
              style={styles.primary}
              onPress={() => {
                openDialog(ready, dialogForCreate(null));
              }}
            >
              <Text style={styles.primaryText}>Author sortie</Text>
            </Pressable>
          ) : null}
          {ready.dialog ? (
            <SortieDialog
              draft={ready.dialog}
              token={token}
              onCancel={() => setScreen({ ...ready, dialog: null, summary: null })}
              onUnauthorized={onUnauthorized}
              onSave={(body) => {
                if (body === "invalid") {
                  setScreen({ ...ready, message: notSaved });
                  return;
                }
                void commit(ready, ready.dialog?.sortieId ?? null, body);
              }}
            />
          ) : null}
          {ready.summary ? (
            <SortieSummary
              sortie={ready.summary}
              message={ready.message}
              onClose={() => setScreen({ ...ready, summary: null })}
              onGuide={
                Platform.OS !== "web" && onGuide
                  ? () => {
                      void guideSortie(ready, ready.summary!);
                    }
                  : null
              }
              onRevise={() => {
                const summary = ready.summary;
                if (summary) {
                  openDialog(ready, dialogFor(summary));
                }
              }}
            />
          ) : null}
        </View>
    </View>
  );
}

function startOfShownDay(anchor: Date): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
}

function dialogFor(sortie: Sortie): DialogDraft {
  return {
    sortieId: sortie.id,
    label: sortie.label,
    arrival: sortie.arrivalAuthored ? new Date(sortie.arrivalAt) : null,
    passengerName: sortie.passengerName ?? "",
    phone: formatUsPhone(sortie.passengerPhone ?? ""),
    ...placesFromSortie(sortie.stops),
  };
}

function dialogForCreate(arrival: Date | null): DialogDraft {
  return {
    sortieId: null,
    label: "",
    arrival,
    passengerName: "",
    phone: "",
    ...emptyPlaces(),
  };
}

function writeFrom(sortie: Sortie, arrival: Date): SortieWriteRequest {
  return {
    label: sortie.label,
    arrivalAt: arrival.toISOString(),
    passengerName: sortie.passengerName,
    passengerPhone: sortie.passengerPhone,
    stops: sortie.stops,
  };
}

function when(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function dayAtPoint(box: GridBox | null, pageX: number, pageY: number): Date | null {
  if (!box || box.width <= 0 || box.height <= 0 || box.days.length === 0) {
    return null;
  }
  const col = Math.floor(((pageX - box.x) / box.width) * 7);
  const rows = box.days.length / 7;
  const row = Math.floor(((pageY - box.y) / box.height) * rows);
  if (col < 0 || col > 6 || row < 0 || row >= rows) {
    return null;
  }
  return box.days[row * 7 + col] ?? null;
}

function scopeLabel(scope: CalendarScope): string {
  if (scope === "month") {
    return "Month";
  }
  if (scope === "week") {
    return "Week";
  }
  return "Day";
}

function MonthChip({
  label,
  enabled,
  onOpen,
  onMove,
}: {
  label: string;
  enabled: boolean;
  onOpen: () => void;
  onMove: (pageX: number, pageY: number) => void;
}) {
  const grant = useRef({ x: 0, y: 0 });
  const latest = useRef({ enabled, onOpen, onMove });
  latest.current = { enabled, onOpen, onMove };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.enabled,
      onMoveShouldSetPanResponder: () => latest.current.enabled,
      onPanResponderGrant: (event) => {
        grant.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      },
      onPanResponderRelease: (event) => {
        const dx = event.nativeEvent.pageX - grant.current.x;
        const dy = event.nativeEvent.pageY - grant.current.y;
        if (Math.abs(dx) <= 4 && Math.abs(dy) <= 4) {
          latest.current.onOpen();
          return;
        }
        latest.current.onMove(event.nativeEvent.pageX, event.nativeEvent.pageY);
      },
    }),
  ).current;
  return (
    <View {...(enabled ? responder.panHandlers : {})} style={[styles.chip, enabled ? null : styles.chipPassthrough]}>
      <Text numberOfLines={1} style={styles.chipText}>
        {label}
      </Text>
    </View>
  );
}

function SortieSummary({
  sortie,
  message,
  onClose,
  onRevise,
  onGuide,
}: {
  sortie: Sortie;
  message: string | null;
  onClose: () => void;
  onRevise: () => void;
  onGuide: (() => void) | null;
}) {
  return (
    <View style={styles.backdrop}>
      <ScrollView contentContainerStyle={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{sortieTitle(sortie)}</Text>
        <SummaryRow label="Arrival" value={when(sortie.arrivalAt)} />
        <SummaryRow label="Start" value={when(sortie.scheduledStart)} />
        <SummaryRow label="Depart from" value={sortie.departureAddress.length > 0 ? sortie.departureAddress : "—"} />
        <SummaryRow label="End" value={when(sortie.scheduledEnd)} />
        <SummaryRow label="Passenger" value={sortie.passengerName ?? "—"} />
        <SummaryRow label="Phone" value={sortie.passengerPhone ? formatUsPhone(sortie.passengerPhone) : "—"} />
        {sortie.stops.map((stop, index) => (
          <SummaryRow key={`${stop.role}-${stop.label}-${index}`} label={stopRoleLabel(stop.role)} value={stop.label} />
        ))}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.summaryActions}>
          {onGuide ? (
            <Pressable onPress={onGuide} style={styles.primary}>
              <Text style={styles.primaryText}>Guide</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onRevise} style={styles.primary}>
            <Text style={styles.primaryText}>Revise</Text>
          </Pressable>
        </View>
        <Pressable onPress={onClose} style={styles.summaryClose}>
          <Text style={styles.secondaryText}>Close</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function stopRoleLabel(role: Sortie["stops"][number]["role"]): string {
  if (role === "pickup") {
    return "Pickup";
  }
  if (role === "destination") {
    return "Destination";
  }
  return "Waypoint";
}

function HourBlock({
  label,
  top,
  height,
  enabled,
  allowDayShift,
  columnWidth,
  onOpen,
  onMove,
}: {
  label: string;
  top: number;
  height: number;
  enabled: boolean;
  allowDayShift: boolean;
  columnWidth: () => number;
  onOpen: () => void;
  onMove: (dayDelta: number, minuteDelta: number) => void;
}) {
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const grant = useRef({ x: 0, y: 0 });
  const latest = useRef({ enabled, allowDayShift, columnWidth, onOpen, onMove });
  latest.current = { enabled, allowDayShift, columnWidth, onOpen, onMove };

  const moveResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.enabled,
      onMoveShouldSetPanResponder: () => latest.current.enabled,
      onPanResponderGrant: (event) => {
        grant.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      },
      onPanResponderMove: (event) => {
        const dx = event.nativeEvent.pageX - grant.current.x;
        const dy = event.nativeEvent.pageY - grant.current.y;
        const dayDelta = latest.current.allowDayShift ? dayDeltaFromPixels(dx, latest.current.columnWidth()) : 0;
        const minuteDelta = minuteDeltaFromPixels(dy);
        setShift({
          x: dayDelta * latest.current.columnWidth(),
          y: (minuteDelta / 60) * hourHeight,
        });
      },
      onPanResponderRelease: (event) => {
        const dx = event.nativeEvent.pageX - grant.current.x;
        const dy = event.nativeEvent.pageY - grant.current.y;
        setShift({ x: 0, y: 0 });
        if (Math.abs(dx) <= 4 && Math.abs(dy) <= 4) {
          latest.current.onOpen();
          return;
        }
        const dayDelta = latest.current.allowDayShift ? dayDeltaFromPixels(dx, latest.current.columnWidth()) : 0;
        latest.current.onMove(dayDelta, minuteDeltaFromPixels(dy));
      },
      onPanResponderTerminate: () => setShift({ x: 0, y: 0 }),
    }),
  ).current;

  return (
    <View
      style={[
        styles.block,
        { top, height, transform: [{ translateX: shift.x }, { translateY: shift.y }] },
      ]}
    >
      <View {...moveResponder.panHandlers} style={styles.blockBody}>
        <Text numberOfLines={2} style={styles.blockText}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 16,
  },
  body: {
    flex: 1,
  },
  period: {
    fontSize: 24,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  gridScroll: {
    flex: 1,
    marginTop: 12,
  },
  weekdays: {
    flexDirection: "row",
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    color: "#555",
  },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14.285%",
    minHeight: 88,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    padding: 2,
    gap: 2,
  },
  dayHit: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: 2,
  },
  today: {
    backgroundColor: "#f3f6ff",
  },
  dayNumber: {
    fontSize: 12,
    zIndex: 1,
  },
  todayText: {
    fontWeight: "700",
  },
  outside: {
    color: "#999",
  },
  chip: {
    backgroundColor: "#111",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    zIndex: 1,
  },
  chipPassthrough: {
    pointerEvents: "none",
  },
  chipText: {
    color: "#fff",
    fontSize: 11,
  },
  hourFrame: {
    flex: 1,
    marginTop: 12,
  },
  dayHeader: {
    flexDirection: "row",
  },
  dayHeading: {
    flex: 1,
    alignItems: "center",
  },
  dayHeadingText: {
    textAlign: "center",
    fontSize: 12,
  },
  hourRow: {
    flexDirection: "row",
  },
  hourGutter: {
    width: 52,
  },
  hourLabel: {
    height: hourHeight,
    fontSize: 11,
    color: "#555",
  },
  dayColumn: {
    flex: 1,
    height: 24 * hourHeight,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
  },
  hourSlot: {
    height: hourHeight,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
  },
  block: {
    position: "absolute",
    left: 2,
    right: 2,
    backgroundColor: "#111",
    borderRadius: 4,
    overflow: "hidden",
  },
  blockBody: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  blockText: {
    color: "#fff",
    fontSize: 11,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    padding: 16,
  },
  summaryCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  summaryTitle: {
    fontSize: 20,
  },
  summaryRow: {
    gap: 2,
  },
  summaryLabel: {
    fontSize: 13,
    color: "#555",
  },
  summaryValue: {
    fontSize: 16,
  },
  summaryClose: {
    backgroundColor: "#eee",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 8,
  },
  summaryActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  message: {
    marginTop: 12,
    fontSize: 16,
  },
  primary: {
    flex: 1,
    backgroundColor: "#111",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  primaryText: {
    color: "#fff",
    fontSize: 16,
  },
  secondary: {
    backgroundColor: "#eee",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  selected: {
    backgroundColor: "#ddd",
  },
  secondaryText: {
    fontSize: 16,
  },
});
