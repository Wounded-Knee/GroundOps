import type { Tariff } from "@groundops/contracts";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { ensureCurrentDriver, requestTariff, saveTariff } from "./calendarClient";

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
  const [message, setMessage] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setMessage(null);
      setEditable(false);
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

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.section}>Meter tariff</Text>
      <Field label="Flag drop ($)" value={flagText} editable={editable} onChange={setFlagText} />
      <Field label="Per mile ($)" value={mileText} editable={editable} onChange={setMileText} />
      <Field label="Per wait minute ($)" value={waitText} editable={editable} onChange={setWaitText} />
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
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
  },
  field: {
    gap: 4,
  },
  label: {
    fontSize: 14,
    color: "#444",
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
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
