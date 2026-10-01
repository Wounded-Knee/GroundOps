import type { Tariff } from "@groundops/contracts";
import Slider from "@react-native-community/slider";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import type { AppearancePreference } from "./appearancePrefs";
import { ensureCurrentDriver, requestTariff, saveTariff } from "./calendarClient";
import {
  defaultGuidanceCameraPrefs,
  ensureGuidanceCameraPrefsLoaded,
  guidanceTiltRange,
  guidanceZoomRange,
  normalizeGuidanceCameraPrefs,
  saveGuidanceCameraPrefs,
} from "./guidanceCameraPrefs";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";

const apiUrl = resolveApiUrl();
const couldNotLoad = "The tariff could not be loaded.";
const notSaved = "The tariff was not saved.";

const appearanceOptions: { value: AppearancePreference; label: string }[] = [
  { value: "dark", label: "Dark Mode" },
  { value: "light", label: "Light Mode" },
  { value: "system", label: "OS Default" },
];

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
      <Text style={styles.section}>Appearance</Text>
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
        <Text style={styles.saveButtonText}>Save camera</Text>
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
        <Text style={styles.saveButtonText}>Save tariff</Text>
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
  const { colors } = useTheme();
  const styles = createStyles(colors);
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
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: {
      flexGrow: 1,
      backgroundColor: colors.background,
      padding: 24,
      justifyContent: "center",
      alignItems: "stretch",
      gap: 12,
    },
    title: {
      fontSize: 24,
      marginBottom: 8,
      textAlign: "center",
      color: colors.text,
    },
    section: {
      fontSize: 16,
      fontWeight: "600",
      marginBottom: 4,
      marginTop: 8,
      color: colors.text,
    },
    appearanceRow: {
      flexDirection: "row",
      gap: 8,
    },
    appearanceOption: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 6,
      alignItems: "center",
      backgroundColor: colors.surface,
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
      backgroundColor: colors.surface,
      color: colors.text,
    },
    inputDisabled: {
      backgroundColor: colors.inputDisabled,
      color: colors.textMuted,
    },
    message: {
      textAlign: "center",
      fontSize: 16,
      color: colors.textSecondary,
    },
    button: {
      backgroundColor: colors.primary,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: "center",
      marginTop: 8,
    },
    save: {
      backgroundColor: colors.accent,
    },
    disabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: colors.primaryText,
      fontSize: 16,
    },
    saveButtonText: {
      color: "#fff",
      fontSize: 16,
    },
  });
}
