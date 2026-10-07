import type { PlaceSuggestion, SortieStop, SortieWriteRequest } from "@groundops/contracts";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import { createElement, useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AddressPicker } from "./AddressPicker";
import { resolveApiUrl } from "./apiUrl";
import {
  arrivalFromDateInput,
  arrivalFromTimeInput,
  calendarDateInputValue,
  calendarTimeInputValue,
  formatCalendarDate,
  formatCalendarTime,
  formatUsPhone,
  hourLabel,
  phoneDigits,
  withPickedDate,
  withPickedTime,
} from "./calendarTime";
import { requestReverseGeocode } from "./routingClient";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";

const apiUrl = resolveApiUrl();

export type StopDraft = {
  query: string;
  chosen: PlaceSuggestion | null;
  waitMinutes: number;
  passenger: boolean;
};

export type DialogDraft = {
  sortieId: string | null;
  label: string;
  arrival: Date | null;
  passengerName: string;
  phone: string;
  stops: StopDraft[];
};

type PickerTarget = "arrival-date" | "arrival-time";

export function SortieDialog({
  draft,
  token,
  message = null,
  onSave,
  onCancel,
  onUnauthorized,
}: {
  draft: DialogDraft;
  token: string;
  message?: string | null;
  onSave: (body: SortieWriteRequest | "invalid") => void;
  onCancel: () => void;
  onUnauthorized: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [label, setLabel] = useState(draft.label);
  const [labelManual, setLabelManual] = useState(draft.sortieId !== null && draft.label.trim().length > 0);
  const [arrival, setArrival] = useState(draft.arrival);
  const [passengerName, setPassengerName] = useState(draft.passengerName);
  const [phone, setPhone] = useState(draft.phone);
  const [stops, setStops] = useState(draft.stops.length > 0 ? draft.stops : [blankStop()]);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const gpsSeeded = useRef(false);

  useEffect(() => {
    if (draft.sortieId !== null || gpsSeeded.current) {
      return;
    }
    gpsSeeded.current = true;
    void (async () => {
      const place = await currentGpsPlace(token, onUnauthorized);
      if (!place) {
        return;
      }
      setStops((current) => {
        const head = current[0];
        if (head && head.chosen !== null) {
          return current;
        }
        const seeded: StopDraft = {
          query: place.label,
          chosen: place,
          waitMinutes: 0,
          passenger: false,
        };
        return current.length === 0 ? [seeded] : [seeded, ...current.slice(1)];
      });
    })();
  }, [draft.sortieId, onUnauthorized, token]);

  useEffect(() => {
    if (labelManual) {
      return;
    }
    setLabel(derivedLabel(passengerName, stops));
  }, [labelManual, passengerName, stops]);

  function applyPicked(target: PickerTarget, picked: Date): void {
    if (Platform.OS === "web") {
      setArrival(picked);
      return;
    }
    if (target === "arrival-date") {
      setArrival((current) => withPickedDate(current ?? new Date(), picked));
    } else {
      setArrival((current) => withPickedTime(current ?? new Date(), picked));
    }
    if (Platform.OS !== "ios") {
      setPicker(null);
    }
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
      arrivalAt: arrival ? arrival.toISOString() : null,
      passengerName: passengerName.trim().length === 0 ? null : passengerName.trim(),
      passengerPhone: digits.length === 0 ? null : digits,
      stops: chosen,
    });
  }

  const pickerMode = picker === "arrival-date" ? "date" : "time";

  return (
    <View style={styles.backdrop}>
      <ScrollView contentContainerStyle={styles.card} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{draft.sortieId ? "Revise sortie" : "Author sortie"}</Text>
        <Text style={styles.fieldLabel}>Label</Text>
        <TextInput
          value={label}
          onChangeText={(value) => {
            setLabelManual(true);
            setLabel(value);
          }}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <View style={styles.arrivalRow}>
          {arrival ? (
            <>
              <View style={styles.arrivalHalf}>
                <PickerButton
                  label="Arrival date"
                  value={formatCalendarDate(arrival)}
                  onPress={() => setPicker("arrival-date")}
                />
              </View>
              <View style={styles.arrivalHalf}>
                <PickerButton
                  label="Arrival time"
                  value={formatCalendarTime(arrival)}
                  onPress={() => setPicker("arrival-time")}
                />
              </View>
            </>
          ) : (
            <View style={styles.arrivalHalf}>
              <PickerButton label="Arrival" value="Leave now" onPress={() => setArrival(new Date())} />
            </View>
          )}
        </View>
        {arrival && picker ? (
          Platform.OS === "web" ? (
            <>
              <WebPicker mode={pickerMode} value={arrival} onPicked={(picked) => applyPicked(picker, picked)} />
              <Pressable onPress={() => setPicker(null)} style={styles.secondary}>
                <Text style={styles.secondaryText}>Done</Text>
              </Pressable>
            </>
          ) : (
            <DateTimePicker
              value={arrival}
              mode={pickerMode}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onValueChange={(_event, date) => applyPicked(picker, date)}
              onDismiss={() => setPicker(null)}
            />
          )
        ) : null}
        {arrival ? (
          <Pressable
            onPress={() => {
              setArrival(null);
              setPicker(null);
            }}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Leave now</Text>
          </Pressable>
        ) : null}
        <Text style={styles.fieldLabel}>Passenger name</Text>
        <TextInput
          value={passengerName}
          onChangeText={setPassengerName}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <Text style={styles.fieldLabel}>Passenger phone</Text>
        <TextInput
          value={phone}
          onChangeText={(value) => setPhone(formatUsPhone(value))}
          keyboardType={Platform.OS === "web" ? "default" : "phone-pad"}
          inputMode={Platform.OS === "web" ? "tel" : undefined}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        {stops.map((stop, index) => (
          <StopFieldset
            key={`stop-${index}`}
            stop={stop}
            token={token}
            canRemove={stops.length > 1}
            onChange={(next) => setStops((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)))}
            onRemove={() => setStops((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            onUnauthorized={onUnauthorized}
          />
        ))}
        <Pressable onPress={() => setStops((current) => [...current, blankStop()])} style={styles.addStop}>
          <Text style={styles.addStopText}>+</Text>
        </Pressable>
        {message ? <Text style={styles.message}>{message}</Text> : null}
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

function StopFieldset({
  stop,
  token,
  canRemove,
  onChange,
  onRemove,
  onUnauthorized,
}: {
  stop: StopDraft;
  token: string;
  canRemove: boolean;
  onChange: (stop: StopDraft) => void;
  onRemove: () => void;
  onUnauthorized: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.legFieldset}>
      <View style={styles.legRow}>
        <Pressable
          onPress={() => onChange({ ...stop, passenger: !stop.passenger })}
          style={[styles.passengerToggle, stop.passenger ? styles.passengerToggleOn : null]}
          accessibilityRole="button"
          accessibilityState={{ selected: stop.passenger }}
          accessibilityLabel="Passenger"
        >
          <Text style={[styles.passengerToggleText, stop.passenger ? styles.passengerToggleTextOn : null]}>P</Text>
        </Pressable>
        <View style={styles.addressSlot}>
          <AddressPicker
            appearance="field"
            query={stop.query}
            token={token}
            onQueryChange={(query) => {
              const chosen = stop.chosen && stop.chosen.label === query ? stop.chosen : null;
              onChange({ query, chosen, waitMinutes: stop.waitMinutes, passenger: stop.passenger });
            }}
            onSelect={(suggestion) =>
              onChange({
                query: suggestion.label,
                chosen: suggestion,
                waitMinutes: stop.waitMinutes,
                passenger: stop.passenger,
              })
            }
            onUnauthorized={onUnauthorized}
          />
        </View>
      </View>
      {stop.chosen ? (
        <>
          <Text style={styles.fieldLabel}>Wait (minutes)</Text>
          <TextInput
            value={String(stop.waitMinutes)}
            onChangeText={(value) => {
              const digits = value.replace(/\D/g, "");
              onChange({ ...stop, waitMinutes: digits.length === 0 ? 0 : Number(digits) });
            }}
            keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
            inputMode={Platform.OS === "web" ? "numeric" : undefined}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          {canRemove ? (
            <Pressable onPress={onRemove} style={styles.secondary}>
              <Text style={styles.secondaryText}>Remove stop</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function PickerButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <Pressable onPress={onPress} style={styles.pickerButton}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.pickerValue}>{value}</Text>
    </Pressable>
  );
}

function WebPicker({ mode, value, onPicked }: { mode: "date" | "time"; value: Date; onPicked: (date: Date) => void }) {
  const shown = mode === "date" ? calendarDateInputValue(value) : calendarTimeInputValue(value);

  function commitTime(raw: string): void {
    const next = arrivalFromTimeInput(raw, value);
    if (next) {
      onPicked(next);
    }
  }

  if (mode === "time") {
    const hour = shown.slice(0, 2);
    const minute = shown.slice(3, 5);
    return createElement(
      "div",
      { style: { display: "flex", gap: 8, marginTop: 8, alignItems: "center" } },
      createElement(
        "select",
        {
          value: hour,
          "aria-label": "Arrival hour",
          onChange: (event: { target: { value: string } }) => commitTime(`${event.target.value}:${minute}`),
          style: { fontSize: 16, padding: 8 },
        },
        ...Array.from({ length: 24 }, (_, h) => {
          const option = String(h).padStart(2, "0");
          return createElement("option", { key: option, value: option }, hourLabel(h));
        }),
      ),
      createElement(
        "select",
        {
          value: minute,
          "aria-label": "Arrival minute",
          onChange: (event: { target: { value: string } }) => commitTime(`${hour}:${event.target.value}`),
          style: { fontSize: 16, padding: 8 },
        },
        ...Array.from({ length: 60 }, (_, m) => {
          const option = String(m).padStart(2, "0");
          return createElement("option", { key: option, value: option }, option);
        }),
      ),
    );
  }

  return createElement("input", {
    type: "date",
    value: shown,
    onChange: (event: { target: { value: string } }) => {
      const next = arrivalFromDateInput(event.target.value, value);
      if (next) {
        onPicked(next);
      }
    },
    style: { fontSize: 16, marginTop: 8, padding: 8 },
  });
}

function chosenStops(drafts: StopDraft[]): SortieStop[] | null {
  if (drafts.length === 0) {
    return null;
  }
  const stops: SortieStop[] = [];
  for (const draft of drafts) {
    const stop = toStop(draft);
    if (!stop) {
      return null;
    }
    stops.push(stop);
  }
  return stops;
}

function toStop(draft: StopDraft): SortieStop | null {
  if (!draft.chosen || !Number.isInteger(draft.waitMinutes) || draft.waitMinutes < 0) {
    return null;
  }
  return {
    label: draft.chosen.label,
    latitude: draft.chosen.latitude,
    longitude: draft.chosen.longitude,
    waitMinutes: draft.waitMinutes,
    passenger: draft.passenger,
  };
}

function blankStop(): StopDraft {
  return { query: "", chosen: null, waitMinutes: 0, passenger: false };
}

function draftFromStop(stop: SortieStop): StopDraft {
  return {
    query: stop.label,
    chosen: { label: stop.label, name: stop.label, detail: "", latitude: stop.latitude, longitude: stop.longitude },
    waitMinutes: stop.waitMinutes,
    passenger: stop.passenger,
  };
}

export function emptyPlaces(): Pick<DialogDraft, "stops"> {
  return { stops: [blankStop()] };
}

export function placesFromSortie(stops: SortieStop[]): Pick<DialogDraft, "stops"> {
  return { stops: stops.length > 0 ? stops.map(draftFromStop) : [blankStop()] };
}

export function sortieTitle(sortie: { label: string; stops: SortieStop[] }): string {
  const label = sortie.label.trim();
  if (label.length > 0) {
    return label;
  }
  return sortie.stops[0]?.label ?? "";
}

export function derivedLabel(passengerName: string, stops: StopDraft[]): string {
  const name = passengerName.trim();
  if (name.length > 0) {
    return name;
  }
  for (const stop of stops) {
    if (stop.passenger && stop.chosen) {
      return stop.chosen.label;
    }
  }
  return "";
}

async function currentGpsPlace(
  token: string,
  onUnauthorized: () => void,
): Promise<PlaceSuggestion | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      return null;
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const coordinate = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    const address = await requestReverseGeocode(apiUrl, token, coordinate);
    if (address === "unauthorized") {
      onUnauthorized();
      return null;
    }
    const label =
      address === "failed" || address.trim().length === 0
        ? `${coordinate.latitude}, ${coordinate.longitude}`
        : address;
    return {
      label,
      name: label,
      detail: "",
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    };
  } catch {
    return null;
  }
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.overlay,
      padding: 16,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      gap: 8,
    },
    title: {
      fontSize: 20,
      color: colors.text,
    },
    arrivalRow: {
      flexDirection: "row",
    },
    arrivalHalf: {
      width: "50%",
    },
    fieldLabel: {
      fontSize: 14,
      marginTop: 4,
      color: colors.text,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    legFieldset: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 8,
      gap: 4,
      marginTop: 4,
    },
    legRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    passengerToggle: {
      width: 44,
      minHeight: 44,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceMuted,
      marginTop: 4,
    },
    passengerToggleOn: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    passengerToggleText: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    passengerToggleTextOn: {
      color: colors.primaryText,
    },
    addressSlot: {
      flex: 1,
      minWidth: 0,
    },
    addStop: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
      marginTop: 8,
    },
    addStopText: {
      fontSize: 22,
      color: colors.text,
      lineHeight: 26,
    },
    pickerButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      width: "100%",
      backgroundColor: colors.surface,
    },
    pickerValue: {
      fontSize: 16,
      color: colors.text,
    },
    primary: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 8,
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
      marginTop: 8,
    },
    secondaryText: {
      fontSize: 16,
      color: colors.text,
    },
    message: {
      marginTop: 8,
      fontSize: 16,
      color: colors.text,
    },
  });
}
