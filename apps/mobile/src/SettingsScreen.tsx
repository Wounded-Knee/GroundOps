import {
  availabilityThresholdMaxMinutes,
  defaultAvailabilitySettings,
  type AvailabilitySettings,
  type GeoCoordinate,
  type Tariff,
} from "@groundops/contracts";
import Slider from "@react-native-community/slider";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { readAvailabilitySettings, saveAvailabilitySettings } from "./availabilityClient";
import type { AppearancePreference } from "./appearancePrefs";
import { ensureCurrentDriver, requestTariff, saveTariff } from "./calendarClient";
import { GeofenceEditor } from "./GeofenceEditor";
import {
  defaultGuidanceCameraPrefs,
  ensureGuidanceCameraPrefsLoaded,
  guidanceTiltRange,
  guidanceZoomRange,
  normalizeGuidanceCameraPrefs,
  saveGuidanceCameraPrefs,
  type GuidanceCameraPrefs,
} from "./guidanceCameraPrefs";
import {
  announceLeadRange,
  defaultGuidanceTimingPrefs,
  ensureGuidanceTimingPrefsLoaded,
  normalizeGuidanceTimingPrefs,
  resumeTravelRange,
  saveGuidanceTimingPrefs,
  stepAdvanceRange,
  type GuidanceTimingPrefs,
} from "./guidanceTimingPrefs";
import {
  countdownLeadFromIndex,
  countdownLeadIndex,
  countdownLeadOptions,
  countdownLeadRangeLabel,
  defaultCountdownLeadMinutes,
  ensureCountdownLeadMinutesLoaded,
  formatCountdownLead,
  getCountdownLeadMinutes,
  saveCountdownLeadMinutes,
  subscribeCountdownLeadMinutes,
  type CountdownLeadMinutes,
} from "./countdownPrefs";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";
import { throb } from "./VisualAlert";
import {
  defaultVisualAlertPrefs,
  ensureVisualAlertPrefsLoaded,
  getVisualAlertPrefs,
  normalizeHexColor,
  saveVisualAlertPrefs,
  subscribeVisualAlertPrefs,
  visualAlertPresets,
  type VisualAlertPrefs,
} from "./visualAlertPrefs";

const apiUrl = resolveApiUrl();
const couldNotLoad = "The tariff could not be loaded.";
const notSaved = "The tariff was not saved.";

const couldNotLoadAvailability = "Availability settings could not be loaded.";
const availabilityNotSaved = "Availability settings were not saved.";

const appearanceOptions: { value: AppearancePreference; label: string }[] = [
  { value: "dark", label: "Dark Mode" },
  { value: "light", label: "Light Mode" },
  { value: "system", label: "OS Default" },
];

type TariffFields = {
  flag: string;
  mile: string;
  wait: string;
};

export function SettingsScreen({
  token,
  signOutMessage,
  onSignOut,
  onUnauthorized,
}: {
  token: string;
  signOutMessage: string | null;
  onSignOut: () => void;
  onUnauthorized: () => void;
}) {
  const { colors, preference, setPreference } = useTheme();
  const styles = createStyles(colors);
  const [flagText, setFlagText] = useState("");
  const [mileText, setMileText] = useState("");
  const [waitText, setWaitText] = useState("");
  const [zoom, setZoom] = useState(defaultGuidanceCameraPrefs.zoom);
  const [tilt, setTilt] = useState(defaultGuidanceCameraPrefs.tilt);
  const [countdownLead, setCountdownLead] = useState<CountdownLeadMinutes>(defaultCountdownLeadMinutes);
  const [announceLead, setAnnounceLead] = useState(defaultGuidanceTimingPrefs.announceLeadMeters);
  const [stepAdvance, setStepAdvance] = useState(defaultGuidanceTimingPrefs.stepAdvanceMeters);
  const [resumeTravel, setResumeTravel] = useState(defaultGuidanceTimingPrefs.resumeTravelMeters);
  const [message, setMessage] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  const [thresholdMinutes, setThresholdMinutes] = useState(defaultAvailabilitySettings.thresholdMinutes);
  const [autoSetUnavailable, setAutoSetUnavailable] = useState(defaultAvailabilitySettings.autoSetUnavailable);
  const [autoSetAvailable, setAutoSetAvailable] = useState(defaultAvailabilitySettings.autoSetAvailable);
  const [geofence, setGeofence] = useState<GeoCoordinate[]>(defaultAvailabilitySettings.geofence);
  const [settingsEditable, setSettingsEditable] = useState(false);
  const [geofenceOpen, setGeofenceOpen] = useState(false);
  const [visualAlert, setVisualAlert] = useState<VisualAlertPrefs>(getVisualAlertPrefs);
  const [hexText, setHexText] = useState(defaultVisualAlertPrefs.color);

  const visualAlertRef = useRef(visualAlert);
  const visualGeneration = useRef(0);
  const visualChain = useRef(Promise.resolve());
  const cameraRef = useRef<GuidanceCameraPrefs>({
    zoom: defaultGuidanceCameraPrefs.zoom,
    tilt: defaultGuidanceCameraPrefs.tilt,
  });
  const cameraGeneration = useRef(0);
  const cameraChain = useRef(Promise.resolve());
  const timingRef = useRef<GuidanceTimingPrefs>({
    announceLeadMeters: defaultGuidanceTimingPrefs.announceLeadMeters,
    stepAdvanceMeters: defaultGuidanceTimingPrefs.stepAdvanceMeters,
    resumeTravelMeters: defaultGuidanceTimingPrefs.resumeTravelMeters,
  });
  const timingGeneration = useRef(0);
  const timingChain = useRef(Promise.resolve());
  const availabilityRef = useRef<AvailabilitySettings>({
    thresholdMinutes: defaultAvailabilitySettings.thresholdMinutes,
    autoSetUnavailable: defaultAvailabilitySettings.autoSetUnavailable,
    autoSetAvailable: defaultAvailabilitySettings.autoSetAvailable,
    geofence: defaultAvailabilitySettings.geofence,
  });
  const availabilityGeneration = useRef(0);
  const availabilityChain = useRef(Promise.resolve());
  const tariffRef = useRef<TariffFields>({ flag: "", mile: "", wait: "" });
  const lastSavedTariff = useRef<Tariff | null>(null);
  const pendingTariff = useRef<Tariff | null>(null);
  const tariffGeneration = useRef(0);
  const tariffChain = useRef(Promise.resolve());
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let cancelled = false;
    void ensureCountdownLeadMinutesLoaded().then((lead) => {
      if (!cancelled) {
        setCountdownLead(lead);
      }
    });
    const unsubscribe = subscribeCountdownLeadMinutes(() => {
      setCountdownLead(getCountdownLeadMinutes());
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void ensureVisualAlertPrefsLoaded();
    return subscribeVisualAlertPrefs(() => {
      const next = getVisualAlertPrefs();
      visualAlertRef.current = next;
      setVisualAlert(next);
      setHexText(next.color);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setMessage(null);
      setEditable(false);
      setSettingsEditable(false);
      const camera = await ensureGuidanceCameraPrefsLoaded();
      const timing = await ensureGuidanceTimingPrefsLoaded();
      if (!cancelled) {
        cameraRef.current = { zoom: camera.zoom, tilt: camera.tilt };
        timingRef.current = {
          announceLeadMeters: timing.announceLeadMeters,
          stepAdvanceMeters: timing.stepAdvanceMeters,
          resumeTravelMeters: timing.resumeTravelMeters,
        };
        setZoom(camera.zoom);
        setTilt(camera.tilt);
        setAnnounceLead(timing.announceLeadMeters);
        setStepAdvance(timing.stepAdvanceMeters);
        setResumeTravel(timing.resumeTravelMeters);
      }
      const driver = await ensureCurrentDriver(apiUrl, token);
      if (cancelled) {
        return;
      }
      if (driver === "unauthorized") {
        onUnauthorizedRef.current();
        return;
      }
      if (driver === "unreachable") {
        setMessage(couldNotLoad);
        return;
      }
      const settings = await readAvailabilitySettings(apiUrl, token);
      if (cancelled) {
        return;
      }
      if (settings === "unauthorized") {
        onUnauthorizedRef.current();
        return;
      }
      if (settings === "unreachable") {
        setMessage(couldNotLoadAvailability);
      } else {
        availabilityRef.current = {
          thresholdMinutes: settings.thresholdMinutes,
          autoSetUnavailable: settings.autoSetUnavailable,
          autoSetAvailable: settings.autoSetAvailable,
          geofence: settings.geofence,
        };
        setThresholdMinutes(settings.thresholdMinutes);
        setAutoSetUnavailable(settings.autoSetUnavailable);
        setAutoSetAvailable(settings.autoSetAvailable);
        setGeofence(settings.geofence);
        setSettingsEditable(true);
      }
      const tariff = await requestTariff(apiUrl, token);
      if (cancelled) {
        return;
      }
      if (tariff === "unauthorized") {
        onUnauthorizedRef.current();
        return;
      }
      if (tariff === "no-driver" || tariff === "unreachable") {
        setMessage(couldNotLoad);
        return;
      }
      const fields = {
        flag: centsToField(tariff.flagCents),
        mile: centsToField(tariff.perMileCents),
        wait: centsToField(tariff.perWaitMinuteCents),
      };
      tariffRef.current = fields;
      lastSavedTariff.current = tariff;
      pendingTariff.current = null;
      setFlagText(fields.flag);
      setMileText(fields.mile);
      setWaitText(fields.wait);
      setEditable(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function persistCamera(): void {
    enqueueLatest(cameraChain, cameraGeneration, async (ticket) => {
      if (ticket !== cameraGeneration.current) {
        return;
      }
      const snapshot = { ...cameraRef.current };
      const saved = await saveGuidanceCameraPrefs(normalizeGuidanceCameraPrefs(snapshot));
      if (ticket !== cameraGeneration.current) {
        return;
      }
      if (cameraRef.current.zoom !== snapshot.zoom || cameraRef.current.tilt !== snapshot.tilt) {
        return;
      }
      cameraRef.current = { zoom: saved.zoom, tilt: saved.tilt };
      setZoom(saved.zoom);
      setTilt(saved.tilt);
    });
  }

  function persistTiming(): void {
    enqueueLatest(timingChain, timingGeneration, async (ticket) => {
      if (ticket !== timingGeneration.current) {
        return;
      }
      const snapshot = { ...timingRef.current };
      const saved = await saveGuidanceTimingPrefs(normalizeGuidanceTimingPrefs(snapshot));
      if (ticket !== timingGeneration.current) {
        return;
      }
      if (
        timingRef.current.announceLeadMeters !== snapshot.announceLeadMeters ||
        timingRef.current.stepAdvanceMeters !== snapshot.stepAdvanceMeters ||
        timingRef.current.resumeTravelMeters !== snapshot.resumeTravelMeters
      ) {
        return;
      }
      timingRef.current = {
        announceLeadMeters: saved.announceLeadMeters,
        stepAdvanceMeters: saved.stepAdvanceMeters,
        resumeTravelMeters: saved.resumeTravelMeters,
      };
      setAnnounceLead(saved.announceLeadMeters);
      setStepAdvance(saved.stepAdvanceMeters);
      setResumeTravel(saved.resumeTravelMeters);
    });
  }

  function commitAvailability(next: AvailabilitySettings): void {
    availabilityRef.current = next;
    setThresholdMinutes(next.thresholdMinutes);
    setAutoSetUnavailable(next.autoSetUnavailable);
    setAutoSetAvailable(next.autoSetAvailable);
    setGeofence(next.geofence);
    if (!settingsEditable) {
      return;
    }
    enqueueLatest(availabilityChain, availabilityGeneration, async (ticket) => {
      if (ticket !== availabilityGeneration.current) {
        return;
      }
      const snapshot = availabilityRef.current;
      const saved = await saveAvailabilitySettings(apiUrl, token, snapshot);
      if (ticket !== availabilityGeneration.current) {
        return;
      }
      if (saved === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (saved === "unreachable" || saved === "rejected") {
        setMessage(availabilityNotSaved);
        return;
      }
      if (!sameAvailability(availabilityRef.current, snapshot)) {
        return;
      }
      availabilityRef.current = saved;
      setThresholdMinutes(saved.thresholdMinutes);
      setAutoSetUnavailable(saved.autoSetUnavailable);
      setAutoSetAvailable(saved.autoSetAvailable);
      setGeofence(saved.geofence);
      setMessage((current) => (current === availabilityNotSaved ? null : current));
    });
  }

  function onTariffChange(field: keyof TariffFields, value: string): void {
    tariffRef.current = { ...tariffRef.current, [field]: value };
    if (field === "flag") {
      setFlagText(value);
    } else if (field === "mile") {
      setMileText(value);
    } else {
      setWaitText(value);
    }
  }

  function onTariffEndEditing(): void {
    if (!editable) {
      return;
    }
    const fieldsAtBlur = { ...tariffRef.current };
    const tariff = parseTariffFields(fieldsAtBlur.flag, fieldsAtBlur.mile, fieldsAtBlur.wait);
    if (!tariff) {
      tariffGeneration.current += 1;
      setMessage(notSaved);
      return;
    }
    const baseline = pendingTariff.current ?? lastSavedTariff.current;
    if (baseline && sameTariff(tariff, baseline)) {
      setMessage((current) => (current === notSaved ? null : current));
      return;
    }
    pendingTariff.current = tariff;
    enqueueLatest(tariffChain, tariffGeneration, async (ticket) => {
      if (ticket !== tariffGeneration.current) {
        return;
      }
      const saved = await saveTariff(apiUrl, token, tariff);
      if (ticket !== tariffGeneration.current) {
        return;
      }
      if (saved === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (saved === "no-driver" || saved === "unreachable" || saved === "rejected") {
        setMessage(notSaved);
        return;
      }
      if (
        tariffRef.current.flag !== fieldsAtBlur.flag ||
        tariffRef.current.mile !== fieldsAtBlur.mile ||
        tariffRef.current.wait !== fieldsAtBlur.wait
      ) {
        return;
      }
      const fields = {
        flag: centsToField(saved.flagCents),
        mile: centsToField(saved.perMileCents),
        wait: centsToField(saved.perWaitMinuteCents),
      };
      tariffRef.current = fields;
      lastSavedTariff.current = saved;
      if (pendingTariff.current && sameTariff(pendingTariff.current, saved)) {
        pendingTariff.current = null;
      }
      setFlagText(fields.flag);
      setMileText(fields.mile);
      setWaitText(fields.wait);
      setMessage((current) => (current === notSaved ? null : current));
    });
  }

  function updateVisualAlert(patch: Partial<VisualAlertPrefs>): void {
    const next = { ...visualAlertRef.current, ...patch };
    visualAlertRef.current = next;
    setVisualAlert(next);
    if (patch.color !== undefined) {
      setHexText(patch.color);
    }
    enqueueLatest(visualChain, visualGeneration, async (ticket) => {
      if (ticket !== visualGeneration.current) {
        return;
      }
      await saveVisualAlertPrefs(visualAlertRef.current);
    });
  }

  function previewVisualAlert(patch: Partial<VisualAlertPrefs>): void {
    const next = { ...visualAlertRef.current, ...patch };
    visualAlertRef.current = next;
    setVisualAlert(next);
  }

  function onHexChange(text: string): void {
    setHexText(text);
    const trimmed = text.trim();
    // Commit only full #RRGGBB while typing so #RGB does not expand mid-entry.
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      updateVisualAlert({ color: trimmed.toUpperCase() });
    }
  }

  function onHexEndEditing(): void {
    const normalized = normalizeHexColor(hexText);
    if (normalized) {
      updateVisualAlert({ color: normalized });
      return;
    }
    setHexText(visualAlert.color);
  }

  if (geofenceOpen && Platform.OS !== "web") {
    return (
      <View style={styles.geofenceCover}>
        <GeofenceEditor
          ring={geofence}
          onCancel={() => setGeofenceOpen(false)}
          onSave={(next) => {
            if (next === "invalid") {
              setMessage("A geofence needs at least three vertices.");
              return;
            }
            setGeofenceOpen(false);
            commitAvailability({ ...availabilityRef.current, geofence: next });
          }}
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Settings</Text>
      <Section title="Appearance">
        <View style={styles.appearanceRow}>
          {appearanceOptions.map((option) => {
            const selected = preference === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setPreference(option.value)}
                style={[styles.appearanceOption, selected ? styles.appearanceOptionSelected : null]}
              >
                <Text style={[styles.appearanceOptionText, selected ? styles.appearanceOptionTextSelected : null]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.subsection}>Visual alert</Text>
        <View style={styles.appearanceRow}>
          {(
            [
              { value: true, label: "On" },
              { value: false, label: "Off" },
            ] as const
          ).map((option) => {
            const selected = visualAlert.enabled === option.value;
            return (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => updateVisualAlert({ enabled: option.value })}
                style={[styles.appearanceOption, selected ? styles.appearanceOptionSelected : null]}
              >
                <Text style={[styles.appearanceOptionText, selected ? styles.appearanceOptionTextSelected : null]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.label}>Color</Text>
        <View style={styles.swatchRow}>
          {visualAlertPresets.map((swatch) => {
            const selected = visualAlert.color === swatch;
            return (
              <Pressable
                key={swatch}
                accessibilityRole="button"
                accessibilityLabel={`Color ${swatch}`}
                accessibilityState={{ selected }}
                onPress={() => updateVisualAlert({ color: swatch })}
                style={[
                  styles.swatch,
                  { backgroundColor: swatch },
                  swatch === "#FFFFFF" ? styles.swatchBordered : null,
                  selected ? styles.swatchSelected : null,
                ]}
              />
            );
          })}
        </View>
        <TextInput
          style={styles.input}
          value={hexText}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="#RRGGBB"
          placeholderTextColor={colors.textMuted}
        onChangeText={onHexChange}
        onBlur={onHexEndEditing}
        />
        <View style={styles.row}>
          <SliderField
            label="Intensity"
            value={visualAlert.intensity}
            minimumValue={0}
            maximumValue={1}
            step={0.01}
            formatValue={formatPercent}
            onChange={(intensity) => previewVisualAlert({ intensity })}
            onSlidingComplete={(intensity) => updateVisualAlert({ intensity })}
          />
          <SliderField
            label="Brightness"
            value={visualAlert.brightness}
            minimumValue={0}
            maximumValue={1}
            step={0.01}
            formatValue={formatPercent}
            onChange={(brightness) => previewVisualAlert({ brightness })}
            onSlidingComplete={(brightness) => updateVisualAlert({ brightness })}
          />
        </View>
        <Pressable style={styles.button} onPress={() => throb(3)}>
          <Text style={styles.buttonText}>Throb 3×</Text>
        </Pressable>
      </Section>
      <Section title="Guidance">
        <SliderField
          label="Next Sortie Countdown"
          value={countdownLeadIndex(countdownLead)}
          minimumValue={0}
          maximumValue={countdownLeadOptions.length - 1}
          step={1}
          rangeHint={countdownLeadRangeLabel}
          formatValue={(index) => formatCountdownLead(countdownLeadFromIndex(index))}
          onChange={(index) => setCountdownLead(countdownLeadFromIndex(index))}
          onSlidingComplete={(index) => {
            const next = countdownLeadFromIndex(index);
            setCountdownLead(next);
            void saveCountdownLeadMinutes(next);
          }}
        />
        <Text style={styles.subsection}>Camera</Text>
        <View style={styles.row}>
          <SliderField
            label="Zoom"
            value={zoom}
            minimumValue={guidanceZoomRange.min}
            maximumValue={guidanceZoomRange.max}
            step={0.5}
            formatValue={formatZoom}
            onChange={(value) => {
              cameraRef.current = { ...cameraRef.current, zoom: value };
              setZoom(value);
            }}
            onSlidingComplete={(value) => {
              cameraRef.current = { ...cameraRef.current, zoom: value };
              setZoom(value);
              persistCamera();
            }}
          />
          <SliderField
            label="Tilt"
            value={tilt}
            minimumValue={guidanceTiltRange.min}
            maximumValue={guidanceTiltRange.max}
            step={1}
            formatValue={formatTilt}
            onChange={(value) => {
              cameraRef.current = { ...cameraRef.current, tilt: value };
              setTilt(value);
            }}
            onSlidingComplete={(value) => {
              cameraRef.current = { ...cameraRef.current, tilt: value };
              setTilt(value);
              persistCamera();
            }}
          />
        </View>
        <Text style={styles.subsection}>Timing</Text>
        <View style={styles.row}>
          <SliderField
            label="Announce lead"
            value={announceLead}
            minimumValue={announceLeadRange.min}
            maximumValue={announceLeadRange.max}
            step={10}
            formatValue={formatMetersSetting}
            onChange={(value) => {
              timingRef.current = { ...timingRef.current, announceLeadMeters: value };
              setAnnounceLead(value);
            }}
            onSlidingComplete={(value) => {
              timingRef.current = { ...timingRef.current, announceLeadMeters: value };
              setAnnounceLead(value);
              persistTiming();
            }}
          />
          <SliderField
            label="Step advance"
            value={stepAdvance}
            minimumValue={stepAdvanceRange.min}
            maximumValue={stepAdvanceRange.max}
            step={5}
            formatValue={formatMetersSetting}
            onChange={(value) => {
              timingRef.current = { ...timingRef.current, stepAdvanceMeters: value };
              setStepAdvance(value);
            }}
            onSlidingComplete={(value) => {
              timingRef.current = { ...timingRef.current, stepAdvanceMeters: value };
              setStepAdvance(value);
              persistTiming();
            }}
          />
        </View>
        <SliderField
          label="Auto-resume travel after a stop"
          value={resumeTravel}
          minimumValue={resumeTravelRange.min}
          maximumValue={resumeTravelRange.max}
          step={5}
          rangeHint="Off–150 m"
          formatValue={formatResumeTravel}
          onChange={(value) => {
            timingRef.current = { ...timingRef.current, resumeTravelMeters: value };
            setResumeTravel(value);
          }}
          onSlidingComplete={(value) => {
            timingRef.current = { ...timingRef.current, resumeTravelMeters: value };
            setResumeTravel(value);
            persistTiming();
          }}
        />
      </Section>
      <Section title="Meter">
        <View style={styles.row}>
          <Field
            label="Flag drop ($)"
            value={flagText}
            editable={editable}
            onChange={(value) => onTariffChange("flag", value)}
            onBlur={onTariffEndEditing}
          />
          <Field
            label="Per mile ($)"
            value={mileText}
            editable={editable}
            onChange={(value) => onTariffChange("mile", value)}
            onBlur={onTariffEndEditing}
          />
          <Field
            label="Per wait minute ($)"
            value={waitText}
            editable={editable}
            onChange={(value) => onTariffChange("wait", value)}
            onBlur={onTariffEndEditing}
          />
        </View>
      </Section>
      <Section title="Availability">
        <SliderField
          label="Availability threshold in minutes"
          value={thresholdMinutes}
          minimumValue={0}
          maximumValue={availabilityThresholdMaxMinutes}
          step={1}
          formatValue={formatMinutes}
          onChange={(value) => {
            if (!settingsEditable) {
              return;
            }
            const threshold = Math.round(value);
            availabilityRef.current = { ...availabilityRef.current, thresholdMinutes: threshold };
            setThresholdMinutes(threshold);
          }}
          onSlidingComplete={(value) => {
            if (!settingsEditable) {
              return;
            }
            const threshold = Math.round(value);
            commitAvailability({ ...availabilityRef.current, thresholdMinutes: threshold });
          }}
        />
        <Text style={styles.label}>Automatically Set Unavailable</Text>
        <OnOff
          value={autoSetUnavailable}
          enabled={settingsEditable}
          onChange={(value) => commitAvailability({ ...availabilityRef.current, autoSetUnavailable: value })}
        />
        <Text style={styles.label}>Automatically Set Available</Text>
        <OnOff
          value={autoSetAvailable}
          enabled={settingsEditable}
          onChange={(value) => commitAvailability({ ...availabilityRef.current, autoSetAvailable: value })}
        />
        <Text style={styles.label}>Availability geofence</Text>
        <Text style={styles.previewHint}>{geofence.length > 0 ? `${geofence.length} vertices` : "No geofence"}</Text>
        {Platform.OS !== "web" ? (
          <Pressable
            style={[styles.button, !settingsEditable ? styles.disabled : null]}
            disabled={!settingsEditable}
            onPress={() => setGeofenceOpen(true)}
          >
            <Text style={styles.buttonText}>{geofence.length === 0 ? "Create geofence" : "Edit geofence"}</Text>
          </Pressable>
        ) : null}
      </Section>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Section title="Account">
        {signOutMessage ? <Text style={styles.message}>{signOutMessage}</Text> : null}
        <Pressable style={styles.button} onPress={onSignOut}>
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </Section>
    </ScrollView>
  );
}

function enqueueLatest(
  chain: { current: Promise<void> },
  generation: { current: number },
  work: (ticket: number) => Promise<void>,
): void {
  const ticket = ++generation.current;
  const run = chain.current.then(() => work(ticket));
  chain.current = run.then(
    () => undefined,
    () => undefined,
  );
}

function sameTariff(left: Tariff, right: Tariff): boolean {
  return (
    left.flagCents === right.flagCents &&
    left.perMileCents === right.perMileCents &&
    left.perWaitMinuteCents === right.perWaitMinuteCents
  );
}

function sameAvailability(left: AvailabilitySettings, right: AvailabilitySettings): boolean {
  return (
    left.thresholdMinutes === right.thresholdMinutes &&
    left.autoSetUnavailable === right.autoSetUnavailable &&
    left.autoSetAvailable === right.autoSetAvailable &&
    sameRing(left.geofence, right.geofence)
  );
}

function sameRing(left: GeoCoordinate[], right: GeoCoordinate[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (point, index) => point.latitude === right[index]?.latitude && point.longitude === right[index]?.longitude,
    )
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.section}>{title}</Text>
      {children}
    </View>
  );
}

function OnOff({
  value,
  enabled,
  onChange,
}: {
  value: boolean;
  enabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.appearanceRow}>
      {(
        [
          { option: true, label: "On" },
          { option: false, label: "Off" },
        ] as const
      ).map((choice) => {
        const selected = value === choice.option;
        return (
          <Pressable
            key={choice.label}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: !enabled }}
            disabled={!enabled}
            onPress={() => onChange(choice.option)}
            style={[
              styles.appearanceOption,
              selected ? styles.appearanceOptionSelected : null,
              !enabled ? styles.disabled : null,
            ]}
          >
            <Text style={[styles.appearanceOptionText, selected ? styles.appearanceOptionTextSelected : null]}>
              {choice.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SliderField({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  rangeHint,
  formatValue,
  onChange,
  onSlidingComplete,
}: {
  label: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  rangeHint?: string;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
  onSlidingComplete: (value: number) => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label} · {formatValue(value)}
      </Text>
      <Text style={styles.rangeHint}>{rangeHint ?? `${minimumValue}–${maximumValue}`}</Text>
      <Slider
        style={styles.slider}
        value={value}
        minimumValue={minimumValue}
        maximumValue={maximumValue}
        step={step}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
        onValueChange={onChange}
        onSlidingComplete={onSlidingComplete}
      />
    </View>
  );
}

function Field({
  label,
  value,
  editable,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, !editable ? styles.inputDisabled : null]}
        value={value}
        editable={editable}
        keyboardType="decimal-pad"
        placeholderTextColor={colors.textMuted}
        onChangeText={onChange}
        onBlur={onBlur}
      />
    </View>
  );
}

export function centsToField(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function parseTariffFields(flag: string, mile: string, wait: string): Tariff | null {
  const flagCents = parseMoneyCents(flag);
  const perMileCents = parseMoneyCents(mile);
  const perWaitMinuteCents = parseMoneyCents(wait);
  if (flagCents === null || perMileCents === null || perWaitMinuteCents === null) {
    return null;
  }
  return { flagCents, perMileCents, perWaitMinuteCents };
}

function parseMoneyCents(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) {
    return null;
  }
  return Math.round(dollars * 100);
}

function formatZoom(value: number): string {
  return value.toFixed(1);
}

function formatTilt(value: number): string {
  return `${Math.round(value)}°`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatMetersSetting(value: number): string {
  return `${Math.round(value)} m`;
}

function formatResumeTravel(value: number): string {
  if (Math.round(value) === 0) {
    return "Off";
  }
  return formatMetersSetting(value);
}

function formatMinutes(value: number): string {
  return `${Math.round(value)}`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: {
      flexGrow: 1,
      backgroundColor: colors.background,
      padding: 20,
      paddingBottom: 32,
      alignItems: "stretch",
      gap: 12,
    },
    geofenceCover: {
      flex: 1,
      backgroundColor: colors.background,
    },
    previewHint: {
      fontSize: 13,
      color: colors.textMuted,
    },
    title: {
      fontSize: 28,
      fontWeight: "600",
      color: colors.text,
    },
    sectionCard: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 16,
      gap: 12,
    },
    section: {
      fontSize: 13,
      fontWeight: "600",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: colors.textMuted,
    },
    subsection: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.text,
    },
    appearanceRow: {
      flexDirection: "row",
      gap: 8,
    },
    swatchRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    swatch: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    swatchBordered: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
    },
    swatchSelected: {
      borderWidth: 3,
      borderColor: colors.accent,
    },
    appearanceOption: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 6,
      alignItems: "center",
      backgroundColor: colors.background,
    },
    appearanceOptionSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    appearanceOptionText: {
      fontSize: 13,
      textAlign: "center",
      color: colors.text,
    },
    appearanceOptionTextSelected: {
      color: "#fff",
      fontWeight: "600",
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
    },
    field: {
      flex: 1,
      gap: 4,
      minWidth: 0,
    },
    label: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    rangeHint: {
      fontSize: 12,
      color: colors.textMuted,
    },
    slider: {
      width: "100%",
      height: 40,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 10,
      fontSize: 16,
      backgroundColor: colors.background,
      color: colors.text,
    },
    inputDisabled: {
      backgroundColor: colors.inputDisabled,
      color: colors.textMuted,
    },
    message: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    button: {
      backgroundColor: colors.primary,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: "center",
    },
    disabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: colors.primaryText,
      fontSize: 16,
    },
  });
}
