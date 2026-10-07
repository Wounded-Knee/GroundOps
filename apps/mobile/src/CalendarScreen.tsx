import type { Sortie, SortieWriteRequest } from "@groundops/contracts";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  PanResponder,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { readCalendarCache, writeCalendarCache } from "./calendarCache";
import {
  authorSortie,
  commenceSortie,
  ensureCurrentDriver,
  requestCalendar,
  requestTariff,
  reviseSortie,
} from "./calendarClient";
import { coalescedStartDate } from "./sortieStart";
import {
  blockOnDay,
  calendarDayDelta,
  clampHourHeight,
  dayDeltaFromPixels,
  formatUsPhone,
  hourHeight,
  hourLabel,
  formatCalendarDate,
  formatCalendarDateTime,
  formatCalendarTime,
  hourSlot,
  minuteDeltaFromPixels,
  monthGridDays,
  nowLineTop,
  periodLabel,
  sameLocalDay,
  shiftAnchor,
  shiftArrival,
  startOfDay,
  visibleRange,
  weekDays,
  type CalendarScope,
} from "./calendarTime";
import type { SortieGuideCommand } from "./sortieGuide";
import { requestSortieDrivingRoute } from "./routingClient";
import { SortieDialog, emptyPlaces, placesFromSortie, sortieTitle, type DialogDraft } from "./SortieDialog";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";

const couldNotLoad = "The calendar could not be loaded.";
const couldNotRefresh = "The calendar could not be refreshed.";
const notSaved = "The sortie was not saved.";
const locationRequired = "Location is required to schedule the sortie.";
const routeFailed = "The route failed.";
const departureFailed = "The departure could not be recorded.";
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
    scope: "day",
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
  scopeCycleToken = 0,
  onUnauthorized,
  onGuide,
}: {
  userId: string;
  token: string;
  reloadToken?: number;
  scopeCycleToken?: number;
  onUnauthorized: () => void;
  onGuide?: (command: SortieGuideCommand) => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [screen, setScreen] = useState<Ready>(() => emptyCalendar(new Date()));
  const [hourPx, setHourPx] = useState(hourHeight);
  const [now, setNow] = useState(() => new Date());
  const generation = useRef(0);
  const saving = useRef(false);
  const gridRef = useRef<View>(null);
  const gridBox = useRef<GridBox | null>(null);
  const columnWidth = useRef(0);
  const hourScroll = useRef<ScrollView>(null);
  const hourFrameRef = useRef<View>(null);
  const hourPxRef = useRef(hourHeight);
  const scrollYRef = useRef(0);
  const hourScrollViewportH = useRef(0);
  const hourFrameBox = useRef({ y: 0, height: 0 });
  const scopeCycleSeen = useRef(scopeCycleToken);
  const pinch = useRef({
    active: false,
    startDist: 0,
    startHourPx: hourHeight,
    startScrollY: 0,
    focalInView: 0,
  });

  hourPxRef.current = hourPx;

  const shown = useRef({ scope: screen.scope, anchor: screen.anchor, live: screen.live });
  shown.current = { scope: screen.scope, anchor: screen.anchor, live: screen.live };

  function scrollNowIntoCenter(at: Date = now): void {
    if (screen.scope === "month") {
      return;
    }
    const viewportHeight = hourScrollViewportH.current;
    if (viewportHeight <= 0) {
      return;
    }
    const nowY = nowLineTop(at, hourPxRef.current);
    const contentHeight = 24 * hourPxRef.current;
    const maxScroll = Math.max(0, contentHeight - viewportHeight);
    const y = Math.min(maxScroll, Math.max(0, nowY - viewportHeight / 2));
    scrollYRef.current = y;
    hourScroll.current?.scrollTo({ y, animated: false });
  }

  function applyHourZoom(nextHourPx: number, startHourPx: number, startScrollY: number, focalInView: number): void {
    const clamped = clampHourHeight(nextHourPx, PixelRatio.get());
    if (clamped === hourPxRef.current) {
      return;
    }
    const nextScroll = Math.max(0, (startScrollY + focalInView) * (clamped / startHourPx) - focalInView);
    setHourPx(clamped);
    hourPxRef.current = clamped;
    scrollYRef.current = nextScroll;
    hourScroll.current?.scrollTo({ y: nextScroll, animated: false });
  }

  const pinchResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (event) => (event.nativeEvent.touches?.length ?? 0) >= 2,
      onMoveShouldSetPanResponderCapture: (event) => (event.nativeEvent.touches?.length ?? 0) >= 2,
      onPanResponderGrant: (event) => beginPinch(event),
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches;
        if ((touches?.length ?? 0) >= 2 && !pinch.current.active) {
          beginPinch(event);
        }
        if (!pinch.current.active || pinch.current.startDist <= 0) {
          return;
        }
        const dist = touchDistance(touches);
        if (dist <= 0) {
          return;
        }
        applyHourZoom(
          pinch.current.startHourPx * (dist / pinch.current.startDist),
          pinch.current.startHourPx,
          pinch.current.startScrollY,
          pinch.current.focalInView,
        );
      },
      onPanResponderRelease: () => {
        pinch.current.active = false;
      },
      onPanResponderTerminate: () => {
        pinch.current.active = false;
      },
    }),
  ).current;

  function beginPinch(event: GestureResponderEvent): void {
    const touches = event.nativeEvent.touches;
    if ((touches?.length ?? 0) < 2) {
      return;
    }
    const dist = touchDistance(touches);
    if (dist <= 0) {
      return;
    }
    const midY = (touches[0]!.pageY + touches[1]!.pageY) / 2;
    pinch.current = {
      active: true,
      startDist: dist,
      startHourPx: hourPxRef.current,
      startScrollY: scrollYRef.current,
      focalInView: Math.max(0, midY - hourFrameBox.current.y),
    };
  }

  useEffect(() => {
    const current = ++generation.current;
    void load("day", new Date(), current);
  }, [token, userId]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

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
    const commenced = await commenceSortie(apiUrl, token, sortie.id);
    if (commenced === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (commenced === "no-location") {
      setScreen({ ...ready, summary: sortie, message: locationRequired });
      return;
    }
    if (typeof commenced === "string") {
      setScreen({ ...ready, summary: sortie, message: departureFailed });
      return;
    }
    setScreen({ ...ready, summary: null, message: null });
    onGuide({
      sortieId: commenced.id,
      stops: commenced.stops,
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
    if (screen.scope === "month") {
      return;
    }
    scrollNowIntoCenter();
  }, [screen.scope, screen.anchor]);

  useEffect(() => {
    if (scopeCycleToken === scopeCycleSeen.current) {
      return;
    }
    scopeCycleSeen.current = scopeCycleToken;
    showPeriod(nextCalendarScope(screen.scope), screen.anchor);
  }, [scopeCycleToken]);

  function confirmArrivalChange(readyState: Ready, sortie: Sortie, arrival: Date): void {
    const whenLabel = formatCalendarDateTime(arrival, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const message = `Move “${sortieTitle(sortie)}” to ${whenLabel}?`;
    confirmChange(message, () => {
      void commit(readyState, sortie.id, writeFrom(sortie, arrival));
    });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
          <Text style={styles.period}>{periodLabel(ready.scope, ready.anchor)}</Text>
          <View style={styles.toolbar}>
            <View style={styles.toolbarGroup}>
              {(["month", "week", "day"] as const).map((scope) => (
                <Pressable
                  key={scope}
                  accessibilityLabel={scopeLabel(scope)}
                  onPress={() => showPeriod(scope, ready.anchor)}
                  style={[styles.iconButton, ready.scope === scope ? styles.selected : null]}
                >
                  <Ionicons name={scopeIcon(scope)} size={20} color={colors.text} />
                </Pressable>
              ))}
            </View>
            <View style={styles.toolbarGroup}>
              <Pressable
                accessibilityLabel="Previous"
                onPress={() => showPeriod(ready.scope, shiftAnchor(ready.scope, ready.anchor, -1))}
                style={styles.iconButton}
              >
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <Pressable
                accessibilityLabel="Today"
                onPress={() => showPeriod(ready.scope, new Date())}
                style={styles.iconButton}
              >
                <Ionicons name="today-outline" size={20} color={colors.text} />
              </Pressable>
              <Pressable
                accessibilityLabel="Next"
                onPress={() => showPeriod(ready.scope, shiftAnchor(ready.scope, ready.anchor, 1))}
                style={styles.iconButton}
              >
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </Pressable>
            </View>
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
                  const chips = ready.sorties.filter((sortie) => sameLocalDay(coalescedStartDate(sortie), day));
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
                              calendarDayDelta(coalescedStartDate(sortie), target),
                              0,
                            );
                            if (!arrival) {
                              return;
                            }
                            confirmArrivalChange(ready, sortie, arrival);
                          }}
                        />
                      ))}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : (
            <View
              ref={hourFrameRef}
              style={styles.hourFrame}
              onLayout={() => {
                hourFrameRef.current?.measureInWindow((_x, y, _width, height) => {
                  hourFrameBox.current = { y, height };
                });
              }}
              {...pinchResponder.panHandlers}
              {...webPinchWheelProps((deltaY) => {
                const startHourPx = hourPxRef.current;
                const factor = deltaY < 0 ? 1.08 : 1 / 1.08;
                applyHourZoom(startHourPx * factor, startHourPx, scrollYRef.current, hourFrameBox.current.height / 2);
              })}
            >
              <View style={styles.dayHeader}>
                <View style={styles.hourGutter} />
                {days.map((day) =>
                  ready.scope === "week" ? (
                    <Pressable key={day.toDateString()} onPress={() => showPeriod("day", day)} style={styles.dayHeading}>
                      <Text style={[styles.dayHeadingText, sameLocalDay(day, new Date()) ? styles.todayText : null]}>
                        {formatCalendarDate(day, { weekday: "short", day: "numeric" })}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text
                      key={day.toDateString()}
                      style={[styles.dayHeading, styles.dayHeadingText, sameLocalDay(day, new Date()) ? styles.todayText : null]}
                    >
                      {formatCalendarDate(day, { weekday: "short", day: "numeric" })}
                    </Text>
                  ),
                )}
              </View>
              <ScrollView
                ref={hourScroll}
                style={styles.gridScroll}
                onLayout={(event) => {
                  hourScrollViewportH.current = event.nativeEvent.layout.height;
                  scrollNowIntoCenter();
                }}
                onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
                  scrollYRef.current = event.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={16}
              >
                <View style={[styles.hourRow, { height: 24 * hourPx }]}>
                  <View style={[styles.hourGutter, { height: 24 * hourPx }]}>
                    {hours.map((hour) => (
                      <Text key={hour} style={[styles.hourLabel, { top: hour * hourPx, height: hourPx }]}>
                        {hourLabel(hour)}
                      </Text>
                    ))}
                  </View>
                  {days.map((day) => (
                    <View
                      key={day.toDateString()}
                      style={[styles.dayColumn, { height: 24 * hourPx }]}
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
                          style={[styles.hourSlot, { top: hour * hourPx, height: hourPx }]}
                        />
                      ))}
                      {ready.sorties.map((sortie) => {
                        const start = coalescedStartDate(sortie);
                        const end = new Date(sortie.scheduledEnd);
                        const block = blockOnDay(start, end, day, hourPx);
                        if (!block) {
                          return null;
                        }
                        return (
                          <HourBlock
                            key={sortie.id}
                            label={sortieTitle(sortie)}
                            top={block.top}
                            height={block.height}
                            hourPx={hourPx}
                            enabled={ready.live && !ready.dialog && !ready.summary}
                            allowDayShift={ready.scope === "week"}
                            columnWidth={() => columnWidth.current}
                            onOpen={() => openSummary(ready, sortie)}
                            onMove={(dayDelta, minuteDelta) => {
                              const arrival = shiftArrival(new Date(sortie.arrivalAt), dayDelta, minuteDelta);
                              if (arrival) {
                                confirmArrivalChange(ready, sortie, arrival);
                              }
                            }}
                          />
                        );
                      })}
                    </View>
                  ))}
                  {days.some((day) => sameLocalDay(day, now)) ? (
                    <View pointerEvents="none" style={[styles.nowLine, { top: nowLineTop(now, hourPx) - nowLineHalf }]}>
                      <View style={styles.nowDot} />
                      <View style={styles.nowStroke} />
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            </View>
          )}
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
  return startOfDay(anchor);
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
  return `${formatCalendarDate(date)} ${formatCalendarTime(date)}`;
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

function nextCalendarScope(scope: CalendarScope): CalendarScope {
  if (scope === "day") {
    return "week";
  }
  if (scope === "week") {
    return "month";
  }
  return "day";
}

/** Half the now-dot height so the stroke centers on the true time Y. */
const nowLineHalf = 4;

function scopeIcon(scope: CalendarScope): keyof typeof Ionicons.glyphMap {
  if (scope === "month") {
    return "calendar";
  }
  if (scope === "week") {
    return "calendar-outline";
  }
  return "square-outline";
}

function touchDistance(touches: GestureResponderEvent["nativeEvent"]["touches"]): number {
  if (!touches || touches.length < 2) {
    return 0;
  }
  const a = touches[0]!;
  const b = touches[1]!;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

function confirmChange(message: string, onConfirm: () => void): void {
  if (Platform.OS === "web") {
    if (typeof globalThis.confirm === "function" && globalThis.confirm(message)) {
      onConfirm();
    }
    return;
  }
  Alert.alert("Confirm change", message, [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", onPress: onConfirm },
  ]);
}

function webPinchWheelProps(onZoom: (deltaY: number) => void): Record<string, unknown> {
  if (Platform.OS !== "web") {
    return {};
  }
  return {
    onWheel: (event: { ctrlKey?: boolean; metaKey?: boolean; deltaY: number; preventDefault?: () => void }) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault?.();
      onZoom(event.deltaY);
    },
  };
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
  const { colors } = useTheme();
  const styles = createStyles(colors);
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
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.backdrop}>
      <ScrollView contentContainerStyle={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{sortieTitle(sortie)}</Text>
        <SummaryRow label="Arrival" value={when(sortie.arrivalAt)} />
        <SummaryRow label="Start" value={when(sortie.actualStart ?? sortie.scheduledStart)} />
        <SummaryRow label="Depart from" value={sortie.departureAddress.length > 0 ? sortie.departureAddress : "—"} />
        <SummaryRow label="End" value={when(sortie.scheduledEnd)} />
        <SummaryRow label="Passenger" value={sortie.passengerName ?? "—"} />
        <SummaryRow label="Phone" value={sortie.passengerPhone ? formatUsPhone(sortie.passengerPhone) : "—"} />
        {sortie.stops.map((stop, index) => {
          const wait = stop.waitMinutes > 0 ? ` · wait ${stop.waitMinutes} min` : "";
          const meter = stop.passenger ? " · meter" : "";
          return (
            <SummaryRow
              key={`${index}-${stop.label}`}
              label={`Stop ${index + 1}`}
              value={`${stop.label}${meter}${wait}`}
            />
          );
        })}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.summaryActions}>
          {onGuide ? (
            <Pressable onPress={onGuide} style={[styles.primary, styles.summaryAction]}>
              <Text style={styles.primaryText}>Guide</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onRevise} style={[styles.primary, styles.summaryAction]}>
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
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function HourBlock({
  label,
  top,
  height,
  hourPx,
  enabled,
  allowDayShift,
  columnWidth,
  onOpen,
  onMove,
}: {
  label: string;
  top: number;
  height: number;
  hourPx: number;
  enabled: boolean;
  allowDayShift: boolean;
  columnWidth: () => number;
  onOpen: () => void;
  onMove: (dayDelta: number, minuteDelta: number) => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const grant = useRef({ x: 0, y: 0 });
  const latest = useRef({ enabled, allowDayShift, columnWidth, onOpen, onMove, hourPx });
  latest.current = { enabled, allowDayShift, columnWidth, onOpen, onMove, hourPx };

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
        const minuteDelta = minuteDeltaFromPixels(dy, latest.current.hourPx);
        setShift({
          x: dayDelta * latest.current.columnWidth(),
          y: (minuteDelta / 60) * latest.current.hourPx,
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
        latest.current.onMove(dayDelta, minuteDeltaFromPixels(dy, latest.current.hourPx));
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
      padding: 16,
    },
    body: {
      flex: 1,
    },
    period: {
      fontSize: 24,
      marginTop: 4,
      color: colors.text,
    },
    toolbar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 12,
    },
    toolbarGroup: {
      flexDirection: "row",
      gap: 8,
    },
    iconButton: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 40,
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
      color: colors.textSecondary,
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
      borderColor: colors.border,
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
      backgroundColor: colors.accentSoft,
    },
    dayNumber: {
      fontSize: 12,
      zIndex: 1,
      color: colors.text,
    },
    todayText: {
      fontWeight: "700",
    },
    outside: {
      color: colors.textMuted,
    },
    chip: {
      backgroundColor: colors.primary,
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingVertical: 2,
      zIndex: 1,
    },
    chipPassthrough: {
      pointerEvents: "none",
    },
    chipText: {
      color: colors.primaryText,
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
      color: colors.text,
    },
    hourRow: {
      flexDirection: "row",
      position: "relative",
    },
    nowLine: {
      position: "absolute",
      left: 44,
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      zIndex: 2,
    },
    nowDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: "#E53935",
      marginLeft: -4,
    },
    nowStroke: {
      flex: 1,
      height: 2,
      backgroundColor: "#E53935",
    },
    hourGutter: {
      width: 52,
      position: "relative",
    },
    hourLabel: {
      position: "absolute",
      left: 0,
      right: 0,
      fontSize: 11,
      color: colors.textSecondary,
    },
    dayColumn: {
      flex: 1,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      position: "relative",
    },
    hourSlot: {
      position: "absolute",
      left: 0,
      right: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    block: {
      position: "absolute",
      left: 2,
      right: 2,
      backgroundColor: colors.primary,
      borderRadius: 4,
      overflow: "hidden",
    },
    blockBody: {
      flex: 1,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    blockText: {
      color: colors.primaryText,
      fontSize: 11,
    },
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.overlay,
      padding: 16,
    },
    summaryCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      gap: 8,
    },
    summaryTitle: {
      fontSize: 20,
      color: colors.text,
    },
    summaryRow: {
      gap: 2,
    },
    summaryLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    summaryValue: {
      fontSize: 16,
      color: colors.text,
    },
    summaryClose: {
      backgroundColor: colors.surfaceMuted,
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
    summaryAction: {
      flex: 1,
      marginTop: 0,
    },
    message: {
      marginTop: 12,
      fontSize: 16,
      color: colors.text,
    },
    primary: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 12,
    },
    primaryText: {
      color: colors.primaryText,
      fontSize: 16,
    },
    secondary: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: "center",
    },
    selected: {
      backgroundColor: colors.border,
    },
    secondaryText: {
      fontSize: 16,
      color: colors.text,
    },
  });
}
