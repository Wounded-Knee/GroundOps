import type { Tariff } from "@groundops/contracts";
import Slider from "@react-native-community/slider";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { ensureCurrentDriver, requestTariff, saveTariff } from "./calendarClient";
import {
  defaultGuidanceCameraPrefs,
  ensureGuidanceCameraPrefsLoaded,
  guidanceTiltRange,
  guidanceZoomRange,
  normalizeGuidanceCameraPrefs,
  saveGuidanceCameraPrefs,
} from "./guidanceCameraPrefs";

const apiUrl = resolveApiUrl();
const couldNotLoad = "The tariff could not be loaded.";
const notSaved = "The tariff was not saved.";

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
  const [flagText, setFlagText] = useState("");
  const [mileText, setMileText] = useState("");
  const [waitText, setWaitText] = useState("");
  const [zoom, setZoom] = useState(defaultGuidanceCameraPrefs.zoom);
  const [tilt, setTilt] = useState(defaultGuidanceCameraPrefs.tilt);
  const [message, setMessage] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingCamera, setSavingCamera] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setMessage(null);
      setEditable(false);
      const camera = await ensureGuidanceCameraPrefsLoaded();
      if (!cancelled) {
        setZoom(camera.zoom);
        setTilt(camera.tilt);
      }
      const driver = await ensureCurrentDriver(apiUrl, token);
      if (cancelled) {
        return;
      }
      if (driver === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (driver === "unreachable") {
        setMessage(couldNotLoad);
        return;
      }
      const tariff = await requestTariff(apiUrl, token);
      if (cancelled) {
        return;
      }
      if (tariff === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (tariff === "no-driver" || tariff === "unreachable") {
        setMessage(couldNotLoad);
        return;
      }
      setFlagText(centsToField(tariff.flagCents));
      setMileText(centsToField(tariff.perMileCents));
      setWaitText(centsToField(tariff.perWaitMinuteCents));
      setEditable(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token, onUnauthorized]);

  async function onSave(): Promise<void> {
    if (!editable || saving) {
      return;
    }
    const tariff = parseTariffFields(flagText, mileText, waitText);
    if (!tariff) {
      setMessage(notSaved);
      return;
    }
    setSaving(true);
    setMessage(null);
    const saved = await saveTariff(apiUrl, token, tariff);
    setSaving(false);
    if (saved === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (saved === "no-driver" || saved === "unreachable" || saved === "rejected") {
      setMessage(notSaved);
      return;
    }
    setFlagText(centsToField(saved.flagCents));
    setMileText(centsToField(saved.perMileCents));
    setWaitText(centsToField(saved.perWaitMinuteCents));
  }

  async function onSaveCamera(): Promise<void> {
    if (savingCamera) {
      return;
    }
    setSavingCamera(true);
    setMessage(null);
    const saved = await saveGuidanceCameraPrefs(normalizeGuidanceCameraPrefs({ zoom, tilt }));
    setSavingCamera(false);
    setZoom(saved.zoom);
    setTilt(saved.tilt);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.section}>Guidance camera</Text>
      <View style={styles.row}>
        <SliderField
          label="Zoom"
          value={zoom}
          minimumValue={guidanceZoomRange.min}
          maximumValue={guidanceZoomRange.max}
          step={0.5}
          formatValue={formatZoom}
          onChange={setZoom}
        />
        <SliderField
          label="Tilt"
          value={tilt}
          minimumValue={guidanceTiltRange.min}
          maximumValue={guidanceTiltRange.max}
          step={1}
          formatValue={formatTilt}
          onChange={setTilt}
        />
      </View>
      <Pressable
        style={[styles.button, styles.save, savingCamera ? styles.disabled : null]}
        disabled={savingCamera}
        onPress={() => void onSaveCamera()}
      >
        <Text style={styles.buttonText}>Save camera</Text>
      </Pressable>
      <Text style={styles.section}>Meter tariff</Text>
      <View style={styles.row}>
        <Field label="Flag drop ($)" value={flagText} editable={editable} onChange={setFlagText} />
        <Field label="Per mile ($)" value={mileText} editable={editable} onChange={setMileText} />
        <Field label="Per wait minute ($)" value={waitText} editable={editable} onChange={setWaitText} />
      </View>
      <Pressable
        style={[styles.button, styles.save, !editable || saving ? styles.disabled : null]}
        disabled={!editable || saving}
        onPress={() => void onSave()}
      >
        <Text style={styles.buttonText}>Save tariff</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {signOutMessage ? <Text style={styles.message}>{signOutMessage}</Text> : null}
      <Pressable style={styles.button} onPress={onSignOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function SliderField({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  formatValue,
  onChange,
}: {
  label: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label} · {formatValue(value)}
      </Text>
      <Text style={styles.rangeHint}>
        {minimumValue}–{maximumValue}
      </Text>
      <Slider
        style={styles.slider}
        value={value}
        minimumValue={minimumValue}
        maximumValue={maximumValue}
        step={step}
        minimumTrackTintColor="#1A73E8"
        maximumTrackTintColor="#ccc"
        thumbTintColor="#1A73E8"
        onValueChange={onChange}
      />
    </View>
  );
}

function Field({
  label,
  value,
  editable,
  onChange,
}: {
  label: string;
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, !editable ? styles.inputDisabled : null]}
        value={value}
        editable={editable}
        keyboardType="decimal-pad"
        onChangeText={onChange}
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

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    backgroundColor: "#fff",
    padding: 24,
    justifyContent: "center",
    alignItems: "stretch",
    gap: 12,
  },
  title: {
    fontSize: 24,
    marginBottom: 8,
    textAlign: "center",
  },
  section: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
    marginTop: 8,
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
    color: "#444",
  },
  rangeHint: {
    fontSize: 12,
    color: "#888",
  },
  slider: {
    width: "100%",
    height: 40,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  inputDisabled: {
    backgroundColor: "#f5f5f5",
    color: "#888",
  },
  message: {
    textAlign: "center",
    fontSize: 16,
    color: "#444",
  },
  button: {
    backgroundColor: "#111",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  save: {
    backgroundColor: "#1A73E8",
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
  },
});
