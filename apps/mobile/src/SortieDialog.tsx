import type { PlaceSuggestion, SortieStop, SortieWriteRequest } from "@groundops/contracts";
import DateTimePicker from "@react-native-community/datetimepicker";
import { createElement, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { formatUsPhone, phoneDigits, withPickedDate, withPickedTime } from "./calendarTime";
import { requestPlaceSuggestions } from "./routingClient";

const apiUrl = resolveApiUrl();

export type StopDraft = {
  query: string;
  chosen: PlaceSuggestion | null;
};

export type DialogDraft = {
  sortieId: string | null;
  label: string;
  start: Date;
  end: Date;
  passengerName: string;
  phone: string;
  stops: StopDraft[];
};

type PickerTarget = "start-date" | "start-time" | "end-date" | "end-time";

export function SortieDialog({
  draft,
  token,
  onSave,
  onCancel,
  onUnauthorized,
}: {
  draft: DialogDraft;
  token: string;
  onSave: (body: SortieWriteRequest | "invalid") => void;
  onCancel: () => void;
  onUnauthorized: () => void;
}) {
  const [label, setLabel] = useState(draft.label);
  const [start, setStart] = useState(draft.start);
  const [end, setEnd] = useState(draft.end);
  const [passengerName, setPassengerName] = useState(draft.passengerName);
  const [phone, setPhone] = useState(draft.phone);
  const [stops, setStops] = useState(draft.stops);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [activeStop, setActiveStop] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);

  useEffect(() => {
    if (activeStop === null) {
      return;
    }
    const stop = stops[activeStop];
    const query = stop?.query.trim() ?? "";
    if (!stop || query.length < 2 || stop.chosen?.label === stop.query) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void requestPlaceSuggestions(apiUrl, token, query, null).then((result) => {
        if (cancelled) {
          return;
        }
        if (result === "unauthorized") {
          onUnauthorized();
          return;
        }
        setSuggestions(result === "failed" ? [] : result);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeStop, onUnauthorized, stops, token]);

  function applyPicked(target: PickerTarget, picked: Date): void {
    if (target === "start-date") {
      setStart((current) => withPickedDate(current, picked));
    } else if (target === "start-time") {
      setStart((current) => withPickedTime(current, picked));
    } else if (target === "end-date") {
      setEnd((current) => withPickedDate(current, picked));
    } else {
      setEnd((current) => withPickedTime(current, picked));
    }
    if (Platform.OS !== "ios") {
      setPicker(null);
    }
  }

  function updateStop(index: number, query: string): void {
    setActiveStop(index);
    setStops((current) =>
      current.map((stop, stopIndex) => {
        if (stopIndex !== index) {
          return stop;
        }
        const chosen = stop.chosen && stop.chosen.label === query ? stop.chosen : null;
        return { query, chosen };
      }),
    );
  }

  function chooseStop(index: number, suggestion: PlaceSuggestion): void {
    setStops((current) =>
      current.map((stop, stopIndex) =>
        stopIndex === index ? { query: suggestion.label, chosen: suggestion } : stop,
      ),
    );
    setSuggestions([]);
    setActiveStop(null);
  }

  function addWaypoint(): void {
    setStops((current) => [
      current[0] ?? { query: "", chosen: null },
      ...current.slice(1, -1),
      { query: "", chosen: null },
      current[current.length - 1] ?? { query: "", chosen: null },
    ]);
  }

  function removeWaypoint(index: number): void {
    setStops((current) => current.filter((_, stopIndex) => stopIndex !== index));
    setActiveStop(null);
    setSuggestions([]);
  }

  function save(): void {
    const chosen = chosenStops(stops);
    if (!chosen) {
      onSave("invalid");
      return;
    }
    const digits = phoneDigits(phone);
    onSave({
      label,
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      passengerName: passengerName.trim().length === 0 ? null : passengerName.trim(),
      passengerPhone: digits.length === 0 ? null : digits,
      stops: chosen,
    });
  }

  const pickerMode = picker?.endsWith("date") ? "date" : "time";
  const pickerValue = picker?.startsWith("start") ? start : end;

  return (
    <View style={styles.backdrop}>
      <ScrollView contentContainerStyle={styles.card} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{draft.sortieId ? "Revise sortie" : "Author sortie"}</Text>
        <Text style={styles.fieldLabel}>Label</Text>
        <TextInput value={label} onChangeText={setLabel} style={styles.input} />
        <PickerButton label="Start date" value={start.toLocaleDateString()} onPress={() => setPicker("start-date")} />
        <PickerButton
          label="Start time"
          value={start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          onPress={() => setPicker("start-time")}
        />
        <PickerButton label="End date" value={end.toLocaleDateString()} onPress={() => setPicker("end-date")} />
        <PickerButton
          label="End time"
          value={end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          onPress={() => setPicker("end-time")}
        />
        {picker ? (
          Platform.OS === "web" ? (
            <WebPicker
              mode={pickerMode}
              value={pickerValue}
              onPicked={(picked) => applyPicked(picker, picked)}
            />
          ) : (
            <DateTimePicker
              value={pickerValue}
              mode={pickerMode}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onValueChange={(_event, date) => applyPicked(picker, date)}
              onDismiss={() => setPicker(null)}
            />
          )
        ) : null}
        <Text style={styles.fieldLabel}>Passenger name</Text>
        <TextInput value={passengerName} onChangeText={setPassengerName} style={styles.input} />
        <Text style={styles.fieldLabel}>Passenger phone</Text>
        <TextInput
          value={phone}
          onChangeText={(value) => setPhone(formatUsPhone(value))}
          keyboardType={Platform.OS === "web" ? "default" : "phone-pad"}
          inputMode={Platform.OS === "web" ? "tel" : undefined}
          style={styles.input}
        />
        {stops.map((stop, index) => (
          <View key={`${stopRole(index, stops.length)}-${index}`}>
            <Text style={styles.fieldLabel}>{stopRole(index, stops.length)}</Text>
            <TextInput
              value={stop.query}
              onChangeText={(query) => updateStop(index, query)}
              onFocus={() => setActiveStop(index)}
              style={styles.input}
            />
            {index > 0 && index < stops.length - 1 ? (
              <Pressable onPress={() => removeWaypoint(index)} style={styles.secondary}>
                <Text style={styles.secondaryText}>Remove waypoint</Text>
              </Pressable>
            ) : null}
            {activeStop === index
              ? suggestions.map((suggestion) => (
                  <Pressable key={`${suggestion.label}-${suggestion.latitude}`} onPress={() => chooseStop(index, suggestion)} style={styles.suggestion}>
                    <Text>{suggestion.label}</Text>
                  </Pressable>
                ))
              : null}
          </View>
        ))}
        <Pressable onPress={addWaypoint} style={styles.secondary}>
          <Text style={styles.secondaryText}>Add waypoint</Text>
        </Pressable>
        <Pressable onPress={save} style={styles.primary}>
          <Text style={styles.primaryText}>Save</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.secondary}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function PickerButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.pickerButton}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.pickerValue}>{value}</Text>
    </Pressable>
  );
}

function WebPicker({ mode, value, onPicked }: { mode: "date" | "time"; value: Date; onPicked: (date: Date) => void }) {
  const shown = mode === "date" ? dateInputValue(value) : timeInputValue(value);
  return createElement("input", {
    type: mode,
    value: shown,
    onChange: (event: { target: { value: string } }) => {
      const next = mode === "date" ? dateFromInput(event.target.value, value) : timeFromInput(event.target.value, value);
      if (next) {
        onPicked(next);
      }
    },
    style: { fontSize: 16, marginTop: 8, padding: 8 },
  });
}

function chosenStops(stops: StopDraft[]): SortieStop[] | null {
  const origin = stops[0]?.chosen;
  const destination = stops[stops.length - 1]?.chosen;
  if (!origin || !destination) {
    return null;
  }
  const waypoints = stops.slice(1, -1).flatMap((stop) => (stop.chosen ? [stop.chosen] : []));
  return [origin, ...waypoints, destination].map((stop) => ({
    label: stop.label,
    latitude: stop.latitude,
    longitude: stop.longitude,
  }));
}

function stopRole(index: number, count: number): string {
  if (index === 0) {
    return "Origin";
  }
  if (index === count - 1) {
    return "Destination";
  }
  return "Waypoint";
}

function dateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeInputValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateFromInput(value: string, base: Date): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return withPickedDate(base, new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function timeFromInput(value: string, base: Date): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return withPickedTime(base, new Date(base.getFullYear(), base.getMonth(), base.getDate(), Number(match[1]), Number(match[2])));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function emptyStops(): StopDraft[] {
  return [
    { query: "", chosen: null },
    { query: "", chosen: null },
  ];
}

export function stopsFromSortie(stops: SortieStop[]): StopDraft[] {
  if (stops.length < 2) {
    return emptyStops();
  }
  return stops.map((stop) => ({
    query: stop.label,
    chosen: { label: stop.label, latitude: stop.latitude, longitude: stop.longitude },
  }));
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    padding: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 20,
  },
  fieldLabel: {
    fontSize: 14,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pickerButton: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pickerValue: {
    fontSize: 16,
  },
  suggestion: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  primary: {
    backgroundColor: "#111",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
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
    marginTop: 8,
  },
  secondaryText: {
    fontSize: 16,
  },
});
