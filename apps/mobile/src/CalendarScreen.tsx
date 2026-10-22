import type { AvailabilityInterval, PlaceSuggestion, Sortie, SortieWriteRequest } from "@groundops/contracts";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { availableYellow } from "./AvailabilityStatus";
import { saveChosenPlace } from "./addressBookStore";
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
import { coalescedEndDate, coalescedStartDate } from "./sortieStart";
import {
  availabilityBlocksOnDay,
  blockOnDay,
  calendarDayDelta,
  type LanePlacement,
  clampHourHeight,
  zoomedScrollY,
  dayDeltaFromPixels,
  formatUsPhone,
  hourHeight,
  hourLabel,
  formatCalendarDate,
  formatCalendarDateTime,
  formatCalendarTime,
  historySorties,
  hourSlot,
  minuteDeltaFromPixels,
  monthGridDays,
  nowLineTop,
  periodLabel,
  placeLanes,
  sameLocalDay,
  shiftAnchor,
  shiftArrival,
  startOfDay,
  upcomingSorties,
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
const longPressMs = 500;

const apiUrl = resolveApiUrl();

type Ready = {
  status: "ready";
  scope: CalendarScope;
  anchor: Date;
  sorties: Sortie[];
  availability: AvailabilityInterval[];
  live: boolean;
  message: string | null;
  dialog: DialogDraft | null;
};

function emptyCalendar(anchor: Date): Ready {
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

type GridBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  days: Date[];
};

type HeldMove = {
  sortieId: string;
  x: number;
  y: number;
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
  const [pinchShift, setPinchShift] = useState(0);
  const [pinchActive, setPinchActive] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [held, setHeld] = useState<HeldMove | null>(null);
  const [hourScrollLocked, setHourScrollLocked] = useState(false);
  const [agendaTab, setAgendaTab] = useState<"upcoming" | "history">("upcoming");
  const [expandedSortieId, setExpandedSortieId] = useState<string | null>(null);
  const [agendaScrollLocked, setAgendaScrollLocked] = useState(false);
  const generation = useRef(0);
  const saving = useRef(false);
  const gridRef = useRef<View>(null);
  const gridBox = useRef<GridBox | null>(null);
  const columnWidth = useRef(0);
  const hourScroll = useRef<ScrollView>(null);
  const hourPxRef = useRef(hourHeight);
  const scrollYRef = useRef(0);
  const hourScrollViewportH = useRef(0);
  const hourScrollBox = useRef({ y: 0, height: 0 });
  const scopeCycleSeen = useRef(scopeCycleToken);
  const pinch = useRef({
    active: false,
    startDist: 0,
    startHourPx: hourHeight,
    startScrollY: 0,
    focalInView: 0,
    focalNow: 0,
    anchorContentY: 0,
    liveHourPx: 0,
  });
  const pendingZoomScroll = useRef<number | null>(null);

  hourPxRef.current = hourPx;

  const shown = useRef({ scope: screen.scope, anchor: screen.anchor, live: screen.live });
  shown.current = { scope: screen.scope, anchor: screen.anchor, live: screen.live };

  function scrollNowIntoCenter(at: Date = now): void {
    if (screen.scope === "month" || screen.scope === "agenda") {
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

  function applyHourZoom(nextHourPx: number, startHourPx: number, anchorContentY: number, focalInScroll: number): void {
    const clamped = clampHourHeight(nextHourPx, PixelRatio.get());
    const nextScroll = zoomedScrollY(
      anchorContentY,
      startHourPx,
      clamped,
      focalInScroll,
      hourScrollViewportH.current,
    );
    const currentPx = pinch.current.active && pinch.current.liveHourPx > 0 ? pinch.current.liveHourPx : hourPxRef.current;
    const scaleChanged = clamped !== currentPx;
    if (pinch.current.active) {
      const sameFocal = Math.abs(focalInScroll - pinch.current.focalNow) <= 0.5;
      if (pinch.current.liveHourPx > 0 && !scaleChanged && sameFocal) {
        return;
      }
    } else if (!scaleChanged && Math.abs(nextScroll - scrollYRef.current) <= 0.5) {
      return;
    }
    if (pinch.current.active) {
      const shift = pinch.current.startScrollY - nextScroll;
      pinch.current.liveHourPx = clamped;
      pinch.current.focalNow = focalInScroll;
      hourPxRef.current = clamped;
      scrollYRef.current = pinch.current.startScrollY;
      setHourPx(clamped);
      setPinchShift(shift);
      return;
    }
    if (scaleChanged) {
      setHourPx(clamped);
      hourPxRef.current = clamped;
    }
    pendingZoomScroll.current = nextScroll;
    scrollYRef.current = nextScroll;
    hourScroll.current?.scrollTo({ y: nextScroll, animated: false });
  }

  const pinchApi = useRef({
    beginPinch: (_event: GestureResponderEvent) => {},
    onMove: (_event: GestureResponderEvent) => {},
    end: () => {},
  });
  const pinchResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (event) => (event.nativeEvent.touches?.length ?? 0) >= 2,
      onMoveShouldSetPanResponderCapture: (event) => (event.nativeEvent.touches?.length ?? 0) >= 2,
      onPanResponderGrant: (event) => pinchApi.current.beginPinch(event),
      onPanResponderMove: (event) => pinchApi.current.onMove(event),
      onPanResponderRelease: () => pinchApi.current.end(),
      onPanResponderTerminate: () => pinchApi.current.end(),
    }),
  ).current;

  function onPinchMove(event: GestureResponderEvent): void {
    const touches = event.nativeEvent.touches;
    const restarted = (touches?.length ?? 0) >= 2 && !pinch.current.active;
    if (restarted) {
      beginPinch(event);
    }
    if (!pinch.current.active || pinch.current.startDist <= 0) {
      return;
    }
    const dist = touchDistance(touches);
    if (dist <= 0) {
      return;
    }
    const midY = touches && touches.length >= 2 ? (touches[0]!.pageY + touches[1]!.pageY) / 2 : null;
    const focalNow = midY === null ? pinch.current.focalInView : Math.max(0, midY - hourScrollBox.current.y);
    applyHourZoom(
      pinch.current.startHourPx * (dist / pinch.current.startDist),
      pinch.current.startHourPx,
      pinch.current.anchorContentY,
      focalNow,
    );
  }

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
    const focalInView = Math.max(0, midY - hourScrollBox.current.y);
    pinch.current = {
      active: true,
      startDist: dist,
      startHourPx: hourPxRef.current,
      startScrollY: scrollYRef.current,
      focalInView,
      anchorContentY: scrollYRef.current + focalInView,
      liveHourPx: hourPxRef.current,
      focalNow: focalInView,
    };
    setPinchActive(true);
    hourScroll.current?.measureInWindow((_x, y, _width, height) => {
      const previousTop = hourScrollBox.current.y;
      hourScrollBox.current = { y, height };
      if (pinch.current.active && Math.abs(previousTop - y) > 1) {
        const focal = Math.max(0, midY - y);
        pinch.current.focalInView = focal;
        pinch.current.anchorContentY = pinch.current.startScrollY + focal;
      }
    });
  }

  pinchApi.current.beginPinch = beginPinch;
  pinchApi.current.onMove = onPinchMove;
  pinchApi.current.end = () => {
    const wasActive = pinch.current.active;
    const live = pinch.current.liveHourPx;
    const focal = pinch.current.focalNow || pinch.current.focalInView;
    pinch.current.active = false;
    pendingZoomScroll.current = null;
    if (!wasActive || live <= 0) {
      return;
    }
    const y = zoomedScrollY(
      pinch.current.anchorContentY,
      pinch.current.startHourPx,
      live,
      focal,
      hourScrollViewportH.current,
    );
    pendingZoomScroll.current = y;
    hourPxRef.current = live;
    setHourPx(live);
    setPinchShift(0);
    setPinchActive(false);
  };

  useLayoutEffect(() => {
    if (pinch.current.active) {
      return;
    }
    const y = pendingZoomScroll.current;
    if (y == null) {
      return;
    }
    pendingZoomScroll.current = null;
    scrollYRef.current = y;
    hourScroll.current?.scrollTo({ y, animated: false });
  }, [hourPx, pinchShift]);

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
      setScreen((prev) =>
        prev.live || prev.message ? prev : { ...prev, sorties: cached.sorties, availability: cached.availability },
      );
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
      message: null,
      dialog: withFreshSortie(prev.dialog, calendar.sorties),
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
      availability: cached?.availability ?? [],
      live: false,
      message: cached ? couldNotRefresh : couldNotLoad,
      dialog: null,
    }));
  }

  function showPeriod(scope: CalendarScope, anchor: Date): void {
    setHeld(null);
    setExpandedSortieId(null);
    setAgendaScrollLocked(false);
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

  async function commit(ready: Ready, sortieId: string | null, body: SortieWriteRequest): Promise<void> {
    if (!ready.live || saving.current) {
      if (!saving.current) {
        setHeld(null);
      }
      return;
    }
    saving.current = true;
    const current = generation.current;
    const saved = sortieId
      ? await reviseSortie(apiUrl, token, sortieId, body)
      : await authorSortie(apiUrl, token, body);
    saving.current = false;
    if (generation.current !== current) {
      setHeld(null);
      return;
    }
    if (saved === "unauthorized") {
      setHeld(null);
      onUnauthorized();
      return;
    }
    if (saved === "no-location") {
      setHeld(null);
      setScreen({ ...ready, message: locationRequired });
      return;
    }
    if (typeof saved === "string") {
      setHeld(null);
      setScreen({ ...ready, message: notSaved });
      return;
    }

    const range = visibleRange(ready.scope, ready.anchor);
    const calendar = await requestCalendar(apiUrl, token, range.from.toISOString(), range.to.toISOString());
    if (generation.current !== current) {
      setHeld(null);
      return;
    }
    if (calendar === "unauthorized") {
      setHeld(null);
      onUnauthorized();
      return;
    }
    if (typeof calendar === "string") {
      setHeld(null);
      setScreen({ ...ready, dialog: null, live: false, message: couldNotRefresh });
      return;
    }
    await writeCalendarCache({
      userId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      sorties: calendar.sorties,
      availability: calendar.availability,
    });
    setHeld(null);
    setExpandedSortieId(null);
    setAgendaScrollLocked(false);
    setScreen({
      ...ready,
      sorties: calendar.sorties,
      availability: calendar.availability,
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

  async function guideSortie(ready: Ready, sortie: Sortie): Promise<void> {
    if (!onGuide || Platform.OS === "web") {
      return;
    }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      setScreen({ ...ready, message: locationRequired });
      return;
    }
    let position: Location.LocationObject;
    try {
      position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
    } catch {
      setScreen({ ...ready, message: locationRequired });
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
      setScreen({ ...ready, message: routeFailed });
      return;
    }
    const commenced = await commenceSortie(apiUrl, token, sortie.id, { guidance: true });
    if (commenced === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (commenced === "no-location") {
      setScreen({ ...ready, message: locationRequired });
      return;
    }
    if (typeof commenced === "string") {
      setScreen({ ...ready, message: departureFailed });
      return;
    }
    setExpandedSortieId(null);
    setScreen({ ...ready, dialog: null, message: null });
    onGuide({
      sortieId: commenced.id,
      stops: commenced.stops,
      firstStopPosition: 0,
      route,
      tariff,
      sortie: commenced,
    });
  }

  async function saveStopAddress(place: PlaceSuggestion): Promise<void> {
    const result = await saveChosenPlace(apiUrl, token, place);
    if (result === "unauthorized") {
      onUnauthorized();
      return;
    }
    const text = result === "ok" ? "Saved." : result === "exists" ? "Already saved." : "The address was not saved.";
    setScreen((current) => ({ ...current, message: text }));
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
    if (screen.scope === "month" || screen.scope === "agenda") {
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

  function confirmArrivalChange(readyState: Ready, sortie: Sortie, arrival: Date, onCancel?: () => void): void {
    const whenLabel = formatCalendarDateTime(arrival, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const message = `Move “${sortieTitle(sortie)}” to ${whenLabel}?`;
    confirmChange(
      message,
      () => {
        void commit(readyState, sortie.id, writeFrom(sortie, arrival));
      },
      onCancel,
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
          <Text style={styles.period}>{periodLabel(ready.scope, ready.anchor)}</Text>
          <View style={styles.toolbar}>
            <View style={styles.toolbarGroup}>
              {(["month", "week", "day", "agenda"] as const).map((scope) => (
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
            {ready.scope === "agenda" ? null : (
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
            )}
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
                          reposition={sortieIsReposition(sortie)}
                          enabled={ready.live && !ready.dialog}
                          onOpen={() => openDialog(ready, dialogFor(sortie))}
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
          ) : ready.scope === "agenda" ? (
            <AgendaList
              tab={agendaTab}
              sorties={ready.sorties}
              now={now}
              live={ready.live}
              expandedSortieId={expandedSortieId}
              scrollLocked={agendaScrollLocked}
              token={token}
              message={ready.message}
              onTab={(tab) => {
                setAgendaTab(tab);
                setExpandedSortieId(null);
                setAgendaScrollLocked(false);
              }}
              onExpand={(sortieId) => {
                if (!ready.live) {
                  return;
                }
                setExpandedSortieId(sortieId);
                setScreen((current) => ({ ...current, dialog: null, message: null }));
              }}
              onCollapse={() => {
                setExpandedSortieId(null);
                setAgendaScrollLocked(false);
              }}
              onSave={(sortieId, body) => {
                if (body === "invalid") {
                  setScreen({ ...ready, message: notSaved });
                  return;
                }
                void commit(ready, sortieId, body);
              }}
              onGuide={
                Platform.OS !== "web" && onGuide
                  ? (sortie) => {
                      void guideSortie(ready, sortie);
                    }
                  : null
              }
              onUnauthorized={onUnauthorized}
              onScrollLock={setAgendaScrollLocked}
              onSaveAddress={(place) => void saveStopAddress(place)}
            />
          ) : (
            <View
              style={styles.hourFrame}
              {...pinchResponder.panHandlers}
              {...webPinchWheelProps((deltaY) => {
                const startHourPx = hourPxRef.current;
                const factor = deltaY < 0 ? 1.08 : 1 / 1.08;
                const focal = hourScrollViewportH.current / 2;
                applyHourZoom(startHourPx * factor, startHourPx, scrollYRef.current + focal, focal);
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
                scrollEnabled={!hourScrollLocked && !pinchActive}
                style={styles.gridScroll}
                onLayout={(event) => {
                  hourScrollViewportH.current = event.nativeEvent.layout.height;
                  hourScroll.current?.measureInWindow((_x, y, _width, measuredHeight) => {
                    hourScrollBox.current = { y, height: measuredHeight };
                  });
                  if (!pinch.current.active) {
                    scrollNowIntoCenter();
                  }
                }}
                onContentSizeChange={(_width, height) => {
                  if (pinch.current.active) {
                    const y = pinch.current.startScrollY;
                    scrollYRef.current = y;
                    hourScroll.current?.scrollTo({ y, animated: false });
                    return;
                  }
                  const pending = pendingZoomScroll.current;
                  if (pending == null) {
                    return;
                  }
                  const maxScroll = Math.max(0, height - hourScrollViewportH.current);
                  const y = Math.min(maxScroll, Math.max(0, pending));
                  scrollYRef.current = y;
                  hourScroll.current?.scrollTo({ y, animated: false });
                  pendingZoomScroll.current = null;
                }}
                onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
                  if (pinch.current.active) {
                    return;
                  }
                  scrollYRef.current = event.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={16}
              >
                <View
                  style={[
                    styles.hourRow,
                    { height: 24 * hourPx },
                    pinchShift !== 0 ? { transform: [{ translateY: pinchShift }] } : null,
                  ]}
                >
                  <View style={[styles.hourGutter, { height: 24 * hourPx }]}>
                    {hours.map((hour) => (
                      <Text key={hour} style={[styles.hourLabel, { top: hour * hourPx, height: hourPx }]}>
                        {hourLabel(hour)}
                      </Text>
                    ))}
                  </View>
                  {days.map((day) => {
                    const lanes = placeLanes(
                      ready.sorties.map((sortie) => ({
                        id: sortie.id,
                        start: coalescedStartDate(sortie),
                        end: coalescedEndDate(sortie),
                      })),
                      day,
                    );
                    return (
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
                          disabled={!ready.live || ready.dialog !== null}
                          onPress={() => {
                            openDialog(ready, dialogForCreate(hourSlot(day, hour).start));
                          }}
                          style={[styles.hourSlot, { top: hour * hourPx, height: hourPx }]}
                        />
                      ))}
                      {ready.sorties.map((sortie) => {
                        const start = coalescedStartDate(sortie);
                        const end = coalescedEndDate(sortie);
                        const block = blockOnDay(start, end, day, hourPx);
                        const lane = lanes.get(sortie.id);
                        if (!block || !lane) {
                          return null;
                        }
                        return (
                          <HourBlock
                            key={sortie.id}
                            label={sortieTitle(sortie)}
                            reposition={sortieIsReposition(sortie)}
                            top={block.top}
                            height={block.height}
                            lane={lane}
                            hourPx={hourPx}
                            enabled={ready.live && !ready.dialog}
                            allowDayShift={ready.scope === "week"}
                            columnWidth={() => columnWidth.current}
                            heldOffset={held?.sortieId === sortie.id ? { x: held.x, y: held.y } : null}
                            onLift={setHourScrollLocked}
                            onOpen={() => openDialog(ready, dialogFor(sortie))}
                            onMove={(dayDelta, minuteDelta) => {
                              const arrival = shiftArrival(new Date(sortie.arrivalAt), dayDelta, minuteDelta);
                              if (!arrival) {
                                setHeld((current) => (current?.sortieId === sortie.id ? null : current));
                                return;
                              }
                              setHeld({
                                sortieId: sortie.id,
                                x: dayDelta * columnWidth.current,
                                y: (minuteDelta / 60) * hourPx,
                              });
                              confirmArrivalChange(ready, sortie, arrival, () => setHeld(null));
                            }}
                          />
                        );
                      })}
                      {ready.scope === "day"
                        ? availabilityBlocksOnDay(ready.availability, day, now, hourPx).map((block, index) => (
                            <View
                              key={`${block.top}-${block.height}-${index}`}
                              pointerEvents="none"
                              style={[styles.availabilityStripe, { top: block.top, height: block.height }]}
                            />
                          ))
                        : null}
                      {sameLocalDay(day, now) ? (
                        <View pointerEvents="none" style={[styles.nowLine, { top: nowLineTop(now, hourPx) - nowLineHalf }]}>
                          <View style={styles.nowDot} />
                          <View style={styles.nowStroke} />
                        </View>
                      ) : null}
                    </View>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}
          {ready.dialog ? (
            <SortieDialog
              draft={ready.dialog}
              token={token}
              message={ready.message}
              onCancel={() => setScreen({ ...ready, dialog: null })}
              onGuide={
                Platform.OS !== "web" && onGuide && ready.dialog.sortie
                  ? () => {
                      const sortie = ready.dialog?.sortie;
                      if (sortie) {
                        void guideSortie(ready, sortie);
                      }
                    }
                  : null
              }
              onUnauthorized={onUnauthorized}
              onSaveAddress={(place) => void saveStopAddress(place)}
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
    sortie,
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

function AgendaList({
  tab,
  sorties,
  now,
  live,
  expandedSortieId,
  scrollLocked,
  token,
  message,
  onTab,
  onExpand,
  onCollapse,
  onSave,
  onGuide,
  onSaveAddress,
  onUnauthorized,
  onScrollLock,
}: {
  tab: "upcoming" | "history";
  sorties: Sortie[];
  now: Date;
  live: boolean;
  expandedSortieId: string | null;
  scrollLocked: boolean;
  token: string;
  message: string | null;
  onTab: (tab: "upcoming" | "history") => void;
  onExpand: (sortieId: string) => void;
  onCollapse: () => void;
  onSave: (sortieId: string, body: SortieWriteRequest | "invalid") => void;
  onGuide: ((sortie: Sortie) => void) | null;
  onSaveAddress: (place: PlaceSuggestion) => void;
  onUnauthorized: () => void;
  onScrollLock: (locked: boolean) => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const listed = tab === "upcoming" ? upcomingSorties(sorties, now) : historySorties(sorties, now);
  return (
    <View style={styles.gridScroll}>
      <View style={styles.agendaTabs}>
        {(["upcoming", "history"] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityLabel={item === "upcoming" ? "Upcoming" : "History"}
            onPress={() => onTab(item)}
            style={[styles.agendaTab, tab === item ? styles.selected : null]}
          >
            <Text style={styles.agendaTabText}>{item === "upcoming" ? "Upcoming" : "History"}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView
        style={styles.gridScroll}
        scrollEnabled={!scrollLocked}
        keyboardShouldPersistTaps="handled"
      >
        {listed.length === 0 ? (
          <Text style={styles.agendaEmpty}>{tab === "upcoming" ? "No upcoming sorties" : "No past sorties"}</Text>
        ) : (
          listed.map((sortie) => {
            const expanded = expandedSortieId === sortie.id;
            const reposition = sortieIsReposition(sortie);
            const firstStop = sortie.stops[0]?.label ?? "";
            const metaStyle = [styles.agendaMeta, reposition ? styles.agendaMetaReposition : null];
            const summary = (
              <View style={styles.agendaCardSummary}>
                <Text style={[styles.agendaTitle, reposition ? styles.agendaTitleReposition : null]}>
                  {sortieTitle(sortie)}
                </Text>
                <Text style={metaStyle}>
                  {formatCalendarDateTime(coalescedStartDate(sortie), {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Text>
                {firstStop.length > 0 ? (
                  <Text numberOfLines={1} style={metaStyle}>
                    {firstStop}
                  </Text>
                ) : null}
                {sortie.passengerName ? (
                  <Text numberOfLines={1} style={metaStyle}>
                    {sortie.passengerName}
                  </Text>
                ) : null}
              </View>
            );
            if (!expanded) {
              return (
                <Pressable
                  key={sortie.id}
                  accessibilityRole="button"
                  disabled={!live}
                  onPress={() => onExpand(sortie.id)}
                  style={[styles.agendaCard, reposition ? styles.agendaCardReposition : null]}
                >
                  {summary}
                </Pressable>
              );
            }
            return (
              <View key={sortie.id} style={[styles.agendaCard, reposition ? styles.agendaCardReposition : null]}>
                <View style={styles.agendaCardHeader}>
                  {summary}
                  <Pressable accessibilityLabel="Collapse" onPress={onCollapse} style={styles.iconButton}>
                    <Ionicons name="chevron-up" size={20} color={reposition ? colors.repositionText : colors.text} />
                  </Pressable>
                </View>
                <SortieDialog
                  layout="inline"
                  draft={dialogFor(sortie)}
                  token={token}
                  message={message}
                  onCancel={onCollapse}
                  onScrollLock={onScrollLock}
                  onUnauthorized={onUnauthorized}
                  onSaveAddress={onSaveAddress}
                  onGuide={onGuide ? () => onGuide(sortie) : null}
                  onSave={(body) => onSave(sortie.id, body)}
                />
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function scopeLabel(scope: CalendarScope): string {
  if (scope === "month") {
    return "Month";
  }
  if (scope === "week") {
    return "Week";
  }
  if (scope === "agenda") {
    return "Agenda";
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
  if (scope === "month") {
    return "agenda";
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
  if (scope === "agenda") {
    return "list-outline";
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

function confirmChange(message: string, onConfirm: () => void, onCancel?: () => void): void {
  let settled = false;
  const confirm = () => {
    if (settled) {
      return;
    }
    settled = true;
    onConfirm();
  };
  const cancel = () => {
    if (settled) {
      return;
    }
    settled = true;
    onCancel?.();
  };
  if (Platform.OS === "web") {
    if (typeof globalThis.confirm === "function" && globalThis.confirm(message)) {
      confirm();
    } else {
      cancel();
    }
    return;
  }
  Alert.alert(
    "Confirm change",
    message,
    [
      { text: "Cancel", style: "cancel", onPress: cancel },
      { text: "Confirm", onPress: confirm },
    ],
    { cancelable: true, onDismiss: cancel },
  );
}

function liftHaptic(): void {
  if (Platform.OS === "android") {
    void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press);
    return;
  }
  if (Platform.OS === "ios") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
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

function sortieIsReposition(sortie: Sortie): boolean {
  return sortie.stops.length > 0 && sortie.stops.every((stop) => !stop.passenger);
}

function MonthChip({
  label,
  reposition,
  enabled,
  onOpen,
  onMove,
}: {
  label: string;
  reposition: boolean;
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
    <View
      {...(enabled ? responder.panHandlers : {})}
      style={[styles.chip, reposition ? styles.chipReposition : null, enabled ? null : styles.chipPassthrough]}
    >
      <Text numberOfLines={1} style={[styles.chipText, reposition ? styles.chipTextReposition : null]}>
        {label}
      </Text>
    </View>
  );
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

function HourBlock({
  label,
  reposition,
  top,
  height,
  lane,
  hourPx,
  enabled,
  allowDayShift,
  columnWidth,
  heldOffset,
  onLift,
  onOpen,
  onMove,
}: {
  label: string;
  reposition: boolean;
  top: number;
  height: number;
  lane: LanePlacement;
  hourPx: number;
  enabled: boolean;
  allowDayShift: boolean;
  columnWidth: () => number;
  heldOffset: { x: number; y: number } | null;
  onLift: (lifted: boolean) => void;
  onOpen: () => void;
  onMove: (dayDelta: number, minuteDelta: number) => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const grant = useRef({ x: 0, y: 0 });
  const armed = useRef(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ enabled, allowDayShift, columnWidth, onLift, onOpen, onMove, hourPx });
  latest.current = { enabled, allowDayShift, columnWidth, onLift, onOpen, onMove, hourPx };

  useEffect(() => {
    return () => {
      if (armTimer.current) {
        clearTimeout(armTimer.current);
        armTimer.current = null;
      }
      if (armed.current) {
        armed.current = false;
        latest.current.onLift(false);
      }
    };
  }, []);

  const moveResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.enabled,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderTerminationRequest: () => !armed.current,
      // Read at touch-down, while the drag is still unarmed, so the native hour scroller is not blocked.
      onShouldBlockNativeResponder: () => armed.current,
      onPanResponderGrant: (event) => {
        armed.current = false;
        grant.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
        if (armTimer.current) {
          clearTimeout(armTimer.current);
        }
        armTimer.current = setTimeout(() => {
          armTimer.current = null;
          if (!latest.current.enabled) {
            return;
          }
          armed.current = true;
          latest.current.onLift(true);
          liftHaptic();
        }, longPressMs);
      },
      onPanResponderMove: (event) => {
        const dx = event.nativeEvent.pageX - grant.current.x;
        const dy = event.nativeEvent.pageY - grant.current.y;
        if (!armed.current) {
          if (Math.hypot(dx, dy) > 10 && armTimer.current) {
            clearTimeout(armTimer.current);
            armTimer.current = null;
          }
          return;
        }
        const dayDelta = latest.current.allowDayShift ? dayDeltaFromPixels(dx, latest.current.columnWidth()) : 0;
        const minuteDelta = minuteDeltaFromPixels(dy, latest.current.hourPx);
        setDrag({
          x: dayDelta * latest.current.columnWidth(),
          y: (minuteDelta / 60) * latest.current.hourPx,
        });
      },
      onPanResponderRelease: (event) => {
        if (armTimer.current) {
          clearTimeout(armTimer.current);
          armTimer.current = null;
        }
        const wasArmed = armed.current;
        if (wasArmed) {
          armed.current = false;
          latest.current.onLift(false);
        }
        const dx = event.nativeEvent.pageX - grant.current.x;
        const dy = event.nativeEvent.pageY - grant.current.y;
        setDrag(null);
        if (!wasArmed) {
          if (Math.abs(dx) <= 4 && Math.abs(dy) <= 4) {
            latest.current.onOpen();
          }
          return;
        }
        const dayDelta = latest.current.allowDayShift ? dayDeltaFromPixels(dx, latest.current.columnWidth()) : 0;
        const minuteDelta = minuteDeltaFromPixels(dy, latest.current.hourPx);
        latest.current.onMove(dayDelta, minuteDelta);
      },
      onPanResponderTerminate: () => {
        if (armTimer.current) {
          clearTimeout(armTimer.current);
          armTimer.current = null;
        }
        if (armed.current) {
          armed.current = false;
          latest.current.onLift(false);
        }
        setDrag(null);
      },
    }),
  ).current;

  const offset = drag ?? heldOffset ?? { x: 0, y: 0 };

  return (
    <View
      style={[
        styles.block,
        {
          top,
          height,
          left: `${(lane.column / lane.columns) * 100}%`,
          width: `${(lane.span / lane.columns) * 100}%`,
          zIndex: drag || heldOffset ? 3 : 0,
          transform: [{ translateX: offset.x }, { translateY: offset.y }],
        },
      ]}
    >
      <View {...moveResponder.panHandlers} style={[styles.blockBody, reposition ? styles.blockBodyReposition : null]}>
        <Text numberOfLines={2} style={[styles.blockText, reposition ? styles.blockTextReposition : null]}>
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
      gap: 8,
      flexWrap: "wrap",
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
    chipReposition: {
      backgroundColor: colors.reposition,
    },
    chipTextReposition: {
      color: colors.repositionText,
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
    availabilityStripe: {
      position: "absolute",
      left: 0,
      width: 4,
      backgroundColor: availableYellow,
      zIndex: 1,
    },
    nowLine: {
      position: "absolute",
      left: 0,
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
      paddingHorizontal: 1,
      overflow: "hidden",
    },
    blockBody: {
      flex: 1,
      paddingHorizontal: 4,
      paddingVertical: 2,
      backgroundColor: colors.primary,
      borderRadius: 4,
      overflow: "hidden",
    },
    blockText: {
      color: colors.primaryText,
      fontSize: 11,
    },
    blockBodyReposition: {
      backgroundColor: colors.reposition,
    },
    blockTextReposition: {
      color: colors.repositionText,
    },
    message: {
      marginTop: 12,
      fontSize: 16,
      color: colors.text,
    },
    selected: {
      backgroundColor: colors.border,
    },
    agendaTabs: {
      flexDirection: "row",
      gap: 8,
    },
    agendaTab: {
      flex: 1,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: "center",
    },
    agendaTabText: {
      fontSize: 16,
      color: colors.text,
    },
    agendaEmpty: {
      marginTop: 24,
      textAlign: "center",
      color: colors.textSecondary,
      fontSize: 16,
    },
    agendaCard: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 12,
    },
    agendaCardReposition: {
      backgroundColor: colors.reposition,
      borderColor: colors.reposition,
    },
    agendaCardHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    agendaCardSummary: {
      flex: 1,
      gap: 2,
    },
    agendaTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.text,
    },
    agendaTitleReposition: {
      color: colors.repositionText,
    },
    agendaMeta: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    agendaMetaReposition: {
      color: colors.repositionText,
    },
  });
}
