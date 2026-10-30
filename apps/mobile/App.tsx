import type { PlaceSuggestion, Sortie, SortieWriteRequest } from "@groundops/contracts";
import { StatusBar } from "expo-status-bar";
import * as QuickActions from "expo-quick-actions";
import type { Action } from "expo-quick-actions";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { AppFrame } from "./src/AppFrame";
import { resolveApiUrl } from "./src/apiUrl";
import { AddressBookScreen } from "./src/AddressBookScreen";
import { destinationFromEntry } from "./src/addressBookMatch";
import {
  addressBookHasLoaded,
  clearAddressBookCache,
  ensureAddressBookLoaded,
  getAddressBookSnapshot,
  saveChosenPlace,
  subscribeAddressBook,
} from "./src/addressBookStore";
import {
  clearPublishedShortcuts,
  ensureDeadheadShortcutsLoaded,
  getDeadheadShortcuts,
  saveDeadheadShortcuts,
  syncPublishedShortcuts,
} from "./src/deadheadShortcutStore";
import { deadheadLink, removeDeadheadShortcut, type DeadheadCommand } from "./src/deadheadShortcutLogic";
import { BottomNav, type SignedInDestination } from "./src/BottomNav";
import { DirectoryScreen } from "./src/DirectoryScreen";
import { CalendarScreen } from "./src/CalendarScreen";
import { LocationReporter } from "./src/LocationReporter";
import { completeSortie } from "./src/calendarClient";
import { saveSortieDraft } from "./src/saveSortie";
import { completedSortie, emptyActivity, meterDisplayForActivity, type AccountActivity } from "./src/liveActivity";
import { formatUsPhone } from "./src/calendarTime";
import { AppWideStatus } from "./src/AppWideStatus";
import type { MeterDisplay } from "./src/meterDisplay";
import { AccountOverview } from "./src/AccountOverview";
import { NavigationScreen } from "./src/NavigationScreen";
import type { SortieGuideCommand } from "./src/sortieGuide";
import type { PlaceGuideCommand } from "./src/placeGuide";
import { SettingsScreen } from "./src/SettingsScreen";
import {
  SortieDialog,
  blankStop,
  draftForPlace,
  emptyPlaces,
  placesFromSortie,
  type DialogDraft,
} from "./src/SortieDialog";
import { useNetworkStatus } from "./src/useNetworkStatus";
import { ThemeProvider, useTheme } from "./src/ThemeProvider";
import type { ThemeColors } from "./src/theme";
import { VisualAlert } from "./src/VisualAlert";
import { useAccountActivity } from "./src/useAccountActivity";
import { useAlwaysOnTop } from "./src/useAlwaysOnTop";
import { useAvailabilitySession } from "./src/useAvailabilitySession";
import { useSession } from "./src/useSession";

const apiUrl = resolveApiUrl();
const notSaved = "The sortie was not saved.";
const locationRequired = "Location is required to schedule the sortie.";

if (__DEV__) {
  console.log(`API URL: ${apiUrl}`);
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

function AppContent() {
  const { scheme, styles } = useAppStyles();
  const liveGeneration = useRef(0);
  const invalidateLive = useCallback(() => {
    liveGeneration.current += 1;
  }, []);
  const setActivityRef = useRef<(activity: AccountActivity) => void>(() => undefined);
  const [destination, setDestination] = useState<SignedInDestination>("navigation");
  const [compose, setCompose] = useState<DialogDraft | null>(null);
  const [composeMessage, setComposeMessage] = useState<string | null>(null);
  const [calendarReload, setCalendarReload] = useState(0);
  const [calendarScopeCycle, setCalendarScopeCycle] = useState(0);
  const [sortieGuide, setSortieGuide] = useState<SortieGuideCommand | null>(null);
  const [placeGuide, setPlaceGuide] = useState<PlaceGuideCommand | null>(null);
  const [deadhead, setDeadhead] = useState<DeadheadCommand | null>(null);
  const [meterReading, setMeterReading] = useState<MeterDisplay | null>(null);
  const [statusChromeHeight, setStatusChromeHeight] = useState(0);
  const bumpCalendar = useCallback(() => {
    setCalendarReload((current) => current + 1);
  }, []);
  const resetChrome = useCallback(() => {
    setDestination("navigation");
    setCompose(null);
    setComposeMessage(null);
    setSortieGuide(null);
    setPlaceGuide(null);
    setDeadhead(null);
    clearAddressBookCache();
    void clearPublishedShortcuts();
    setMeterReading(null);
    setActivityRef.current(emptyActivity);
  }, []);
  const {
    phase,
    submitting,
    onSignIn,
    onSignOut,
    onRetry,
    onSessionRejected,
    onUnauthorized,
    setLive,
  } = useSession({ apiUrl, resetChrome, invalidateLive });
  const { activity, setActivity, socketLink } = useAccountActivity({
    apiUrl,
    sessionToken: phase.status === "signed-in" ? phase.token : null,
    generation: liveGeneration,
    onSessionRejected,
    onCalendarChanged: bumpCalendar,
    setLive,
  });
  setActivityRef.current = setActivity;
  const { availability, availabilityLoaded, availabilityBusy, availabilityMessage, toggleAvailability } =
    useAvailabilitySession({
      apiUrl,
      sessionToken: phase.status === "signed-in" ? phase.token : null,
      onSessionRejected,
      onCalendarChanged: bumpCalendar,
    });
  const { visualAlert, floating, onActiveNavigationChange } = useAlwaysOnTop(phase.status);
  const networkFault = useNetworkStatus(apiUrl, socketLink);
  const endGuidanceRef = useRef<(() => void) | null>(null);
  const meterArriveRef = useRef<(() => void) | null>(null);
  const meterPlusOneRef = useRef<(() => void) | null>(null);
  const meterOnwardRef = useRef<(() => void) | null>(null);
  const meterCommenceRef = useRef<(() => void) | null>(null);
  const applySortieUpdateRef = useRef<((sortie: Sortie) => void) | null>(null);
  const composeSaving = useRef(false);
  const pendingShortcutId = useRef<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const openShortcutRef = useRef<(token: string, userId: string, entryId: string) => Promise<void>>(
    async () => undefined,
  );

  const sessionToken = phase.status === "signed-in" ? phase.token : null;
  const signedInUserId = phase.status === "signed-in" ? phase.user.id : null;

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    const take = (action: Action | null | undefined) => {
      const entryId = action?.params?.entryId;
      if (typeof entryId !== "string" || entryId.length === 0) {
        return;
      }
      const current = phaseRef.current;
      if (current.status !== "signed-in") {
        pendingShortcutId.current = entryId;
        return;
      }
      void openShortcutRef.current(current.token, current.user.id, entryId);
    };
    if (QuickActions.initial) {
      take(QuickActions.initial);
    }
    const subscription = QuickActions.addListener((action) => take(action));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (phase.status !== "signed-in") {
      return;
    }
    const entryId = pendingShortcutId.current;
    if (!entryId) {
      return;
    }
    pendingShortcutId.current = null;
    void openShortcutRef.current(phase.token, phase.user.id, entryId);
  }, [phase]);

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    let initialUrl: string | null | undefined;
    let queued: string | null = null;
    function open(url: string | null): void {
      const link = deadheadLink(url);
      if (!link || link.kind !== "start") {
        return;
      }
      const current = phaseRef.current;
      if (current.status !== "signed-in") {
        pendingShortcutId.current = link.entryId;
        return;
      }
      void openShortcutRef.current(current.token, current.user.id, link.entryId);
    }
    const subscription = Linking.addEventListener("url", (event) => {
      if (initialUrl === undefined) {
        queued = event.url;
        return;
      }
      if (event.url === initialUrl) {
        initialUrl = null;
        return;
      }
      open(event.url);
    });
    void Linking.getInitialURL().then((url) => {
      initialUrl = url;
      open(url);
      if (queued !== null && queued !== url) {
        open(queued);
      } else if (queued !== null) {
        initialUrl = null;
      }
      queued = null;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" || !sessionToken || !signedInUserId) {
      return;
    }
    const token = sessionToken;
    const userId = signedInUserId;
    let cancelled = false;
    let ready = false;
    void (async () => {
      await ensureDeadheadShortcutsLoaded(userId);
      if (cancelled) {
        return;
      }
      const loaded = await ensureAddressBookLoaded(apiUrl, token);
      if (cancelled || loaded !== "ok" || !addressBookHasLoaded()) {
        return;
      }
      ready = true;
      const entries = getAddressBookSnapshot().entries;
      try {
        await syncPublishedShortcuts(entries);
      } catch {
        // Publishing needs the installed build that registers the shortcuts.
      }
    })();
    const unsubscribe = subscribeAddressBook(() => {
      if (!ready || !addressBookHasLoaded()) {
        return;
      }
      const entries = getAddressBookSnapshot().entries;
      void syncPublishedShortcuts(entries).catch(() => undefined);
    });
    return () => {
      cancelled = true;
      ready = false;
      unsubscribe();
    };
  }, [sessionToken, signedInUserId]);

  async function openDeadheadShortcut(token: string, userId: string, entryId: string): Promise<void> {
    setDestination("navigation");
    const loaded = await ensureAddressBookLoaded(apiUrl, token);
    if (loaded === "unauthorized") {
      await onSessionRejected();
      return;
    }
    if (loaded !== "ok") {
      setDeadhead({ kind: "unavailable" });
      return;
    }
    const entry = getAddressBookSnapshot().entries.find((item) => item.id === entryId);
    if (!entry) {
      try {
        await ensureDeadheadShortcutsLoaded(userId);
        const next = removeDeadheadShortcut(getDeadheadShortcuts(), entryId);
        if (next.length !== getDeadheadShortcuts().length) {
          await saveDeadheadShortcuts(userId, next);
          await syncPublishedShortcuts(getAddressBookSnapshot().entries);
        }
      } catch {
        // The icon may stay until the next publish. The driver still hears that the place is gone.
      }
      setDeadhead({ kind: "missing" });
      return;
    }
    setDeadhead({ kind: "start", destination: destinationFromEntry(entry) });
  }

  openShortcutRef.current = openDeadheadShortcut;

  function releaseSortie(completed: Sortie): void {
    setActivity((current) =>
      current.sortie?.id === completed.id ? { ...current, sortie: null, meter: null } : current,
    );
    setMeterReading(null);
    setCalendarReload((current) => current + 1);
  }

  async function finishHeldSortie(token: string, sortieId: string): Promise<void> {
    const result = await completeSortie(resolveApiUrl(), token, sortieId);
    if (result === "unauthorized") {
      await onSessionRejected();
      return;
    }
    const completed = completedSortie(result);
    if (completed === null) {
      return;
    }
    releaseSortie(completed);
  }

  function openCompose(): void {
    setComposeMessage(null);
    setCompose({
      sortieId: null,
      label: "",
      arrival: null,
      passengerName: "",
      phone: "",
      ...emptyPlaces(),
    });
  }

  function openComposeForPlace(place: PlaceSuggestion): void {
    setComposeMessage(null);
    setCompose(draftForPlace(place));
  }

  async function saveComposeAddress(token: string, place: PlaceSuggestion): Promise<void> {
    const result = await saveChosenPlace(apiUrl, token, place);
    if (result === "unauthorized") {
      await onSessionRejected();
      return;
    }
    setComposeMessage(result === "ok" ? "Saved." : result === "exists" ? "Already saved." : "The address was not saved.");
  }

  function onNavigate(next: SignedInDestination): void {
    if (next === "calendar" && destination === "calendar" && compose === null) {
      setCalendarScopeCycle((count) => count + 1);
      return;
    }
    setCompose(null);
    setComposeMessage(null);
    setDestination(next);
  }

  function openOnwardDialog(sortie: Sortie): void {
    const stops = [...placesFromSortie(sortie.stops).stops, blankStop()];
    setComposeMessage(null);
    setCompose({
      sortieId: sortie.id,
      label: sortie.label,
      arrival: sortie.arrivalAuthored ? new Date(sortie.arrivalAt) : null,
      passengerName: sortie.passengerName ?? "",
      phone: formatUsPhone(sortie.passengerPhone ?? ""),
      stops,
      focusStopIndex: stops.length - 1,
    });
  }

  async function saveCompose(token: string, body: SortieWriteRequest | "invalid"): Promise<void> {
    if (body === "invalid") {
      setComposeMessage(notSaved);
      return;
    }
    if (composeSaving.current) {
      return;
    }
    composeSaving.current = true;
    const revising = compose?.sortieId ?? null;
    const saved = await saveSortieDraft(apiUrl, token, revising, body);
    composeSaving.current = false;
    if (saved === "unauthorized") {
      await onSessionRejected();
      return;
    }
    if (saved === "no-location") {
      setComposeMessage(locationRequired);
      return;
    }
    if (saved === "not-saved") {
      setComposeMessage(notSaved);
      return;
    }
    if (revising) {
      applySortieUpdateRef.current?.(saved);
    }
    setCompose(null);
    setComposeMessage(null);
    setCalendarReload((current) => current + 1);
  }

  const signedIn = phase.status === "signed-in";
  const statusOverlaysMap = destination === "navigation" && compose === null;
  const heldMeter = meterDisplayForActivity(activity.sortie, activity.meter);
  const shownMeter = meterReading ?? heldMeter;
  const appWideStatus = (
    <AppWideStatus
      reading={shownMeter}
      current={availability.current}
      loaded={availabilityLoaded}
      busy={availabilityBusy}
      message={availabilityMessage}
      onToggleAvailability={toggleAvailability}
      onEndSortie={() => {
        if (endGuidanceRef.current) {
          endGuidanceRef.current();
          return;
        }
        if (phase.status !== "signed-in") {
          return;
        }
        const open = activity.sortie;
        if (open === null || open.actualStart === null || open.actualEnd !== null) {
          return;
        }
        void finishHeldSortie(phase.token, open.id);
      }}
      onArrive={() => meterArriveRef.current?.()}
      onPlusOneMinute={() => meterPlusOneRef.current?.()}
      onOnwardDestination={() => meterOnwardRef.current?.()}
      onCommenceNext={() => meterCommenceRef.current?.()}
    />
  );
  const floatingMap = Platform.OS === "android" && floating;
  const mapUnderStatusBar =
    Platform.OS === "android" && signedIn && destination === "navigation" && compose === null && !floatingMap;
  const screenCover = floatingMap ? [styles.cover, styles.hidden] : styles.cover;
  const overlay = (
    <VisualAlert
      color={visualAlert.color}
      intensity={visualAlert.intensity}
      brightness={visualAlert.brightness}
      enabled={visualAlert.enabled}
      suppressed={floatingMap}
    />
  );

  return (
    <AppFrame overlay={overlay} edgeToEdge={floatingMap} omitTopInset={mapUnderStatusBar}>
      <View style={signedIn ? styles.signedIn : styles.container}>
        {phase.status === "loading" ? <Text style={styles.message}>Checking session…</Text> : null}
        {phase.status === "signed-out" ? (
          <SignIn message={phase.message} disabled={submitting} onSignIn={() => void onSignIn()} />
        ) : null}
        {phase.status === "offline" ? <Offline message={phase.message} onRetry={() => void onRetry()} /> : null}
        {signedIn ? (
          <>
            <LocationReporter token={phase.token} onUnauthorized={onUnauthorized} />
            <View style={styles.content}>
              {Platform.OS !== "web" ? (
                <NavigationScreen
                  token={phase.token}
                  onUnauthorized={onUnauthorized}
                  sortieGuide={sortieGuide}
                  onSortieGuideConsumed={() => setSortieGuide(null)}
                  placeGuide={placeGuide}
                  onPlaceGuideConsumed={() => setPlaceGuide(null)}
                  deadhead={deadhead}
                  onDeadheadConsumed={() => setDeadhead(null)}
                  onMeterReading={setMeterReading}
                  onMeterEnded={() => {
                    setMeterReading(null);
                  }}
                  onSortieCompleted={(completed) => {
                    releaseSortie(completed);
                  }}
                  onOnwardDestination={openOnwardDialog}
                  endGuidanceRef={endGuidanceRef}
                  meterArriveRef={meterArriveRef}
                  meterPlusOneRef={meterPlusOneRef}
                  meterOnwardRef={meterOnwardRef}
                  meterCommenceRef={meterCommenceRef}
                  applySortieUpdateRef={applySortieUpdateRef}
                  accountView={{ user: phase.user, live: phase.live, activity }}
                  networkFault={networkFault}
                  minimal={floatingMap}
                  onActiveNavigationChange={onActiveNavigationChange}
                  bottomInset={statusOverlaysMap && !floatingMap ? statusChromeHeight : 0}
                  underStatusBar={mapUnderStatusBar}
                />
              ) : null}
              {Platform.OS === "web" && destination === "navigation" ? (
                <View style={styles.cover}>
                  <AccountOverview accountView={{ user: phase.user, live: phase.live, activity }} />
                </View>
              ) : null}
              {destination === "calendar" ? (
                <View style={screenCover} pointerEvents={floatingMap ? "none" : "auto"}>
                  <CalendarScreen
                    userId={phase.user.id}
                    token={phase.token}
                    reloadToken={calendarReload}
                    scopeCycleToken={calendarScopeCycle}
                    onUnauthorized={onUnauthorized}
                    onGuide={(command) => {
                      setSortieGuide(command);
                      setDestination("navigation");
                    }}
                  />
                </View>
              ) : null}
              {destination === "addresses" ? (
                <View style={screenCover} pointerEvents={floatingMap ? "none" : "auto"}>
                  <AddressBookScreen
                    token={phase.token}
                    userId={phase.user.id}
                    onUnauthorized={onUnauthorized}
                    onGuide={(command) => {
                      setPlaceGuide(command);
                      setDestination("navigation");
                    }}
                    onCreateSortie={openComposeForPlace}
                  />
                </View>
              ) : null}
              {destination === "settings" ? (
                <View style={screenCover} pointerEvents={floatingMap ? "none" : "auto"}>
                  <SettingsScreen
                    token={phase.token}
                    signOutMessage={phase.signOutMessage}
                    onSignOut={() => void onSignOut(phase.token)}
                    onUnauthorized={onUnauthorized}
                  />
                </View>
              ) : null}
              {destination === "directory" && phase.user.platformAdministrator ? (
                <View style={screenCover} pointerEvents={floatingMap ? "none" : "auto"}>
                  <DirectoryScreen token={phase.token} onUnauthorized={onUnauthorized} />
                </View>
              ) : null}
              {compose ? (
                <View style={[styles.dialogCover, floatingMap ? styles.hidden : null]} pointerEvents="box-none">
                  <SortieDialog
                    draft={compose}
                    token={phase.token}
                    message={composeMessage}
                    onCancel={() => {
                      setCompose(null);
                      setComposeMessage(null);
                    }}
                    onUnauthorized={onUnauthorized}
                    onSaveAddress={(place) => void saveComposeAddress(phase.token, place)}
                    onSave={(body) => void saveCompose(phase.token, body)}
                  />
                </View>
              ) : null}
              {!floatingMap && statusOverlaysMap ? (
                <View
                  style={styles.meterOverlay}
                  pointerEvents="box-none"
                  onLayout={(event) => {
                    const next = Math.round(event.nativeEvent.layout.height);
                    setStatusChromeHeight((current) => (current === next ? current : next));
                  }}
                >
                  {appWideStatus}
                </View>
              ) : null}
            </View>
            {!floatingMap && !statusOverlaysMap ? appWideStatus : null}
            {!floatingMap ? (
              <BottomNav
                destination={destination}
                composeOpen={compose !== null}
                showDirectory={phase.user.platformAdministrator}
                onNavigate={onNavigate}
                onCompose={openCompose}
              />
            ) : null}
          </>
        ) : null}
        <StatusBar style={mapUnderStatusBar ? "dark" : scheme === "dark" ? "light" : "dark"} hidden={floatingMap} />
      </View>
    </AppFrame>
  );
}

function SignIn({
  message,
  disabled,
  onSignIn,
}: {
  message: string | null;
  disabled: boolean;
  onSignIn: () => void;
}) {
  const { styles } = useAppStyles();
  return (
    <>
      <Pressable style={styles.button} disabled={disabled} onPress={onSignIn}>
        <Text style={styles.buttonText}>Sign in with Google</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </>
  );
}

function Offline({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { styles } = useAppStyles();
  return (
    <>
      <Text style={styles.message}>{message}</Text>
      <Pressable style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>Retry</Text>
      </Pressable>
    </>
  );
}

let cachedAppStyles: { colors: ThemeColors; styles: ReturnType<typeof createStyles> } | null = null;

function useAppStyles() {
  const { colors, scheme } = useTheme();
  if (cachedAppStyles?.colors !== colors) {
    cachedAppStyles = { colors, styles: createStyles(colors) };
  }
  return { colors, scheme, styles: cachedAppStyles.styles };
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    signedIn: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
    },
    cover: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.background,
    },
    meterOverlay: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 5,
    },
    hidden: {
      display: "none",
    },
    dialogCover: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    message: {
      marginTop: 16,
      textAlign: "center",
      color: colors.text,
    },
    button: {
      backgroundColor: colors.primary,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderRadius: 8,
    },
    buttonText: {
      color: colors.primaryText,
      fontSize: 16,
    },
  });
}
