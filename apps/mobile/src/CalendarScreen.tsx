import type { Sortie, SortieWriteRequest } from "@groundops/contracts";
import { useEffect, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { readCalendarCache, writeCalendarCache } from "./calendarCache";
import { authorSortie, ensureCurrentDriver, requestCalendar, reviseSortie } from "./calendarClient";
import {
  blockOnDay,
  calendarDayDelta,
  dayDeltaFromPixels,
  defaultInterval,
  endsOnDay,
  formatUsPhone,
  hourHeight,
  hourLabel,
  hourSlot,
  minuteDeltaFromPixels,
  monthGridDays,
  moveInterval,
  periodLabel,
  resizeEnd,
  resizeStart,
  sameLocalDay,
  shiftAnchor,
  shiftIntervalDays,
  startsOnDay,
  visibleRange,
  weekDays,
  type CalendarScope,
  type Interval,
} from "./calendarTime";
import { SortieDialog, emptyStops, stopsFromSortie, type DialogDraft } from "./SortieDialog";

const couldNotLoad = "The calendar could not be loaded.";
const couldNotRefresh = "The calendar could not be refreshed.";
const notSaved = "The sortie was not saved.";
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
};

type Screen = { status: "loading" } | { status: "unavailable" } | Ready;

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
  onClose,
  onUnauthorized,
}: {
  userId: string;
  token: string;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [screen, setScreen] = useState<Screen>({ status: "loading" });
  const generation = useRef(0);
  const saving = useRef(false);
  const gridRef = useRef<View>(null);
  const gridBox = useRef<GridBox | null>(null);
  const columnWidth = useRef(0);
  const hourScroll = useRef<ScrollView>(null);

  useEffect(() => {
    const current = ++generation.current;
    void load("month", new Date(), current);
  }, [token, userId]);

  async function load(scope: CalendarScope, anchor: Date, current: number): Promise<void> {
    const range = visibleRange(scope, anchor);
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
    setScreen({
      status: "ready",
      scope,
      anchor,
      sorties: calendar.sorties,
      live: true,
      message: null,
      dialog: null,
    });
  }

  async function showCached(scope: CalendarScope, anchor: Date, current: number): Promise<void> {
    const cached = await readCalendarCache(userId);
    if (generation.current !== current) {
      return;
    }
    if (!cached) {
      setScreen({ status: "unavailable" });
      return;
    }
    setScreen({
      status: "ready",
      scope,
      anchor,
      sorties: cached.sorties,
      live: false,
      message: couldNotRefresh,
      dialog: null,
    });
  }

  function showPeriod(scope: CalendarScope, anchor: Date): void {
    const current = ++generation.current;
    setScreen((currentScreen) =>
      currentScreen.status === "ready"
        ? {
            ...currentScreen,
            scope,
            anchor,
            dialog: null,
            message: currentScreen.live ? null : currentScreen.message,
          }
        : { status: "loading" },
    );
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
    setScreen({ ...ready, dialog, message: null });
  }

  const ready = screen.status === "ready" ? screen : null;
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
      <Pressable onPress={onClose} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      {screen.status === "loading" ? <Text style={styles.message}>Loading calendar…</Text> : null}
      {screen.status === "unavailable" ? <Text style={styles.message}>{couldNotLoad}</Text> : null}
      {ready ? (
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
                          label={sortie.label}
                          enabled={ready.live && !ready.dialog}
                          onOpen={() => openDialog(ready, dialogFor(sortie))}
                          onMove={(pageX, pageY) => {
                            const target = dayAtPoint(gridBox.current, pageX, pageY);
                            if (!target) {
                              return;
                            }
                            const interval = shiftIntervalDays(
                              new Date(sortie.scheduledStart),
                              new Date(sortie.scheduledEnd),
                              calendarDayDelta(new Date(sortie.scheduledStart), target),
                            );
                            if (!interval) {
                              return;
                            }
                            void commit(ready, sortie.id, writeFrom(sortie, interval));
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
                          disabled={!ready.live || ready.dialog !== null}
                          onPress={() => {
                            const slot = hourSlot(day, hour);
                            openDialog(ready, dialogForCreate(slot.start, slot.end));
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
                            label={sortie.label}
                            top={block.top}
                            height={block.height}
                            enabled={ready.live && !ready.dialog}
                            allowDayShift={ready.scope === "week"}
                            canResizeStart={startsOnDay(start, day)}
                            canResizeEnd={endsOnDay(end, day)}
                            columnWidth={() => columnWidth.current}
                            onOpen={() => openDialog(ready, dialogFor(sortie))}
                            onMove={(dayDelta, minuteDelta) => {
                              const interval = moveInterval(start, end, dayDelta, minuteDelta);
                              if (interval) {
                                void commit(ready, sortie.id, writeFrom(sortie, interval));
                              }
                            }}
                            onResize={(edge, minuteDelta) => {
                              const interval =
                                edge === "start" ? resizeStart(start, end, minuteDelta) : resizeEnd(start, end, minuteDelta);
                              if (!interval) {
                                if (minuteDelta !== 0) {
                                  setScreen({ ...ready, message: notSaved });
                                }
                                return;
                              }
                              void commit(ready, sortie.id, writeFrom(sortie, interval));
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
          {ready.live && !ready.dialog ? (
            <Pressable
              style={styles.primary}
              onPress={() => {
                const slot = defaultInterval(ready.scope, ready.anchor);
                openDialog(ready, dialogForCreate(slot.start, slot.end));
              }}
            >
              <Text style={styles.primaryText}>Author sortie</Text>
            </Pressable>
          ) : null}
          {ready.dialog ? (
            <SortieDialog
              draft={ready.dialog}
              token={token}
              onCancel={() => setScreen({ ...ready, dialog: null })}
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
        </View>
      ) : null}
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
    start: new Date(sortie.scheduledStart),
    end: new Date(sortie.scheduledEnd),
    passengerName: sortie.passengerName ?? "",
    phone: formatUsPhone(sortie.passengerPhone ?? ""),
    stops: stopsFromSortie(sortie.stops),
  };
}

function dialogForCreate(start: Date, end: Date): DialogDraft {
  return {
    sortieId: null,
    label: "",
    start,
    end,
    passengerName: "",
    phone: "",
    stops: emptyStops(),
  };
}

function writeFrom(sortie: Sortie, interval: Interval): SortieWriteRequest {
  return {
    label: sortie.label,
    scheduledStart: interval.start.toISOString(),
    scheduledEnd: interval.end.toISOString(),
    passengerName: sortie.passengerName,
    passengerPhone: sortie.passengerPhone,
    stops: sortie.stops,
  };
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

function HourBlock({
  label,
  top,
  height,
  enabled,
  allowDayShift,
  canResizeStart,
  canResizeEnd,
  columnWidth,
  onOpen,
  onMove,
  onResize,
}: {
  label: string;
  top: number;
  height: number;
  enabled: boolean;
  allowDayShift: boolean;
  canResizeStart: boolean;
  canResizeEnd: boolean;
  columnWidth: () => number;
  onOpen: () => void;
  onMove: (dayDelta: number, minuteDelta: number) => void;
  onResize: (edge: "start" | "end", minuteDelta: number) => void;
}) {
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const [edgeShift, setEdgeShift] = useState<{ edge: "start" | "end"; minutes: number } | null>(null);
  const grant = useRef({ x: 0, y: 0 });
  const latest = useRef({ enabled, allowDayShift, columnWidth, onOpen, onMove, onResize });
  latest.current = { enabled, allowDayShift, columnWidth, onOpen, onMove, onResize };

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

  function edgeResponder(edge: "start" | "end") {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.enabled,
      onMoveShouldSetPanResponder: () => latest.current.enabled,
      onPanResponderGrant: (event) => {
        grant.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      },
      onPanResponderMove: (event) => {
        setEdgeShift({ edge, minutes: minuteDeltaFromPixels(event.nativeEvent.pageY - grant.current.y) });
      },
      onPanResponderRelease: (event) => {
        const minutes = minuteDeltaFromPixels(event.nativeEvent.pageY - grant.current.y);
        setEdgeShift(null);
        latest.current.onResize(edge, minutes);
      },
      onPanResponderTerminate: () => setEdgeShift(null),
    });
  }

  const startEdge = useRef(edgeResponder("start")).current;
  const endEdge = useRef(edgeResponder("end")).current;
  const resized = edgeShift ? resizedFrame(top, height, edgeShift.edge, edgeShift.minutes) : { top, height };

  return (
    <View
      style={[
        styles.block,
        { top: resized.top, height: resized.height, transform: [{ translateX: shift.x }, { translateY: shift.y }] },
      ]}
    >
      {canResizeStart ? <View {...startEdge.panHandlers} style={styles.edge} /> : null}
      <View {...moveResponder.panHandlers} style={styles.blockBody}>
        <Text numberOfLines={2} style={styles.blockText}>
          {label}
        </Text>
      </View>
      {canResizeEnd ? <View {...endEdge.panHandlers} style={styles.edge} /> : null}
    </View>
  );
}

function resizedFrame(
  top: number,
  height: number,
  edge: "start" | "end",
  minutes: number,
): { top: number; height: number } {
  const delta = (minutes / 60) * hourHeight;
  if (edge === "start") {
    const nextTop = top + delta;
    const nextHeight = height - delta;
    if (nextHeight < 32) {
      return { top, height };
    }
    return { top: nextTop, height: nextHeight };
  }
  return { top, height: Math.max(32, height + delta) };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 16,
    paddingTop: Platform.OS === "android" ? 36 : 16,
  },
  body: {
    flex: 1,
  },
  back: {
    alignSelf: "flex-start",
    paddingVertical: 8,
  },
  backText: {
    fontSize: 16,
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
  edge: {
    height: 8,
    backgroundColor: "#333",
  },
  message: {
    marginTop: 12,
    fontSize: 16,
  },
  primary: {
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
