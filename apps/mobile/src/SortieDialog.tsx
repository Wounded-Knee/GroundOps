import type { PlaceSuggestion, SortieStop, SortieWriteRequest, StopRole } from "@groundops/contracts";
import DateTimePicker from "@react-native-community/datetimepicker";
import { createElement, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AddressPicker } from "./AddressPicker";
import { formatUsPhone, phoneDigits, withPickedDate, withPickedTime } from "./calendarTime";

export type StopDraft = {
  query: string;
  chosen: PlaceSuggestion | null;
};

export type DialogDraft = {
  sortieId: string | null;
  label: string;
  arrival: Date | null;
  passengerName: string;
  phone: string;
  pickup: StopDraft;
  destination: StopDraft;
  waypoints: StopDraft[];
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
  const [label, setLabel] = useState(draft.label);
  const [arrival, setArrival] = useState(draft.arrival);
  const [passengerName, setPassengerName] = useState(draft.passengerName);
  const [phone, setPhone] = useState(draft.phone);
  const [pickup, setPickup] = useState(draft.pickup);
  const [destination, setDestination] = useState(draft.destination);
  const [waypoints, setWaypoints] = useState(draft.waypoints);
  const [picker, setPicker] = useState<PickerTarget | null>(null);

  function applyPicked(target: PickerTarget, picked: Date): void {
    if (target === "arrival-date") {
      setArrival((current) => withPickedDate(current ?? new Date(), picked));
    } else {
      setArrival((current) => withPickedTime(current ?? new Date(), picked));
    }
    if (Platform.OS !== "ios") {
      setPicker(null);
    }
  }

  function clearEnd(which: "pickup" | "destination"): void {
    if (which === "pickup") {
      setPickup(blankStop());
    } else {
      setDestination(blankStop());
    }
    setWaypoints([]);
  }

  function save(): void {
    const stops = chosenStops(pickup, destination, waypoints);
    if (!stops) {
      onSave("invalid");
      return;
    }
    const digits = phoneDigits(phone);
    onSave({
      label,
      arrivalAt: arrival ? arrival.toISOString() : null,
      passengerName: passengerName.trim().length === 0 ? null : passengerName.trim(),
      passengerPhone: digits.length === 0 ? null : digits,
      stops,
    });
  }

  const bothEnds = pickup.chosen !== null && destination.chosen !== null;
  const pickerMode = picker === "arrival-date" ? "date" : "time";

  return (
    <View style={styles.backdrop}>
      <ScrollView contentContainerStyle={styles.card} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{draft.sortieId ? "Revise sortie" : "Author sortie"}</Text>
        <Text style={styles.fieldLabel}>Label</Text>
        <TextInput value={label} onChangeText={setLabel} style={styles.input} />
        <View style={styles.arrivalRow}>
          {arrival ? (
            <>
              <View style={styles.arrivalHalf}>
                <PickerButton
                  label="Arrival date"
                  value={arrival.toLocaleDateString()}
                  onPress={() => setPicker("arrival-date")}
                />
              </View>
              <View style={styles.arrivalHalf}>
                <PickerButton
                  label="Arrival time"
                  value={arrival.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
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
            <WebPicker mode={pickerMode} value={arrival} onPicked={(picked) => applyPicked(picker, picked)} />
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
        <TextInput value={passengerName} onChangeText={setPassengerName} style={styles.input} />
        <Text style={styles.fieldLabel}>Passenger phone</Text>
        <TextInput
          value={phone}
          onChangeText={(value) => setPhone(formatUsPhone(value))}
          keyboardType={Platform.OS === "web" ? "default" : "phone-pad"}
          inputMode={Platform.OS === "web" ? "tel" : undefined}
          style={styles.input}
        />
        <PlaceField
          label="Pickup"
          stop={pickup}
          token={token}
          clearLabel="Clear pickup"
          onChange={setPickup}
          onClear={() => clearEnd("pickup")}
          onUnauthorized={onUnauthorized}
        />
        {waypoints.map((stop, index) => (
          <View key={`waypoint-${index}`}>
            <PlaceField
              label="Waypoint"
              stop={stop}
              token={token}
              onChange={(next) =>
                setWaypoints((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)))
              }
              onClear={() => setWaypoints((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              clearLabel="Remove waypoint"
              onUnauthorized={onUnauthorized}
            />
          </View>
        ))}
        <PlaceField
          label="Destination"
          stop={destination}
          token={token}
          clearLabel="Clear destination"
          onChange={setDestination}
          onClear={() => clearEnd("destination")}
          onUnauthorized={onUnauthorized}
        />
        {bothEnds ? (
          <Pressable onPress={() => setWaypoints((current) => [...current, blankStop()])} style={styles.secondary}>
            <Text style={styles.secondaryText}>Add waypoint</Text>
          </Pressable>
        ) : null}
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

function PlaceField({
  label,
  stop,
  token,
  clearLabel = "Clear",
  onChange,
  onClear,
  onUnauthorized,
}: {
  label: string;
  stop: StopDraft;
  token: string;
  clearLabel?: string;
  onChange: (stop: StopDraft) => void;
  onClear: () => void;
  onUnauthorized: () => void;
}) {
  return (
    <View>
      <AddressPicker
        label={label}
        appearance="field"
        query={stop.query}
        token={token}
        onQueryChange={(query) => {
          const chosen = stop.chosen && stop.chosen.label === query ? stop.chosen : null;
          onChange({ query, chosen });
        }}
        onSelect={(suggestion) => onChange({ query: suggestion.label, chosen: suggestion })}
        onUnauthorized={onUnauthorized}
      />
      {stop.chosen ? (
        <Pressable onPress={onClear} style={styles.secondary}>
          <Text style={styles.secondaryText}>{clearLabel}</Text>
        </Pressable>
      ) : null}
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

function chosenStops(pickup: StopDraft, destination: StopDraft, waypoints: StopDraft[]): SortieStop[] | null {
  if (!pickup.chosen && !destination.chosen) {
    return null;
  }
  const stops: SortieStop[] = [];
  if (pickup.chosen) {
    stops.push(toStop("pickup", pickup.chosen));
  }
  if (pickup.chosen && destination.chosen) {
    for (const waypoint of waypoints) {
      if (!waypoint.chosen) {
        return null;
      }
      stops.push(toStop("waypoint", waypoint.chosen));
    }
  }
  if (destination.chosen) {
    stops.push(toStop("destination", destination.chosen));
  }
  return stops;
}

function toStop(role: StopRole, suggestion: PlaceSuggestion): SortieStop {
  return {
    role,
    label: suggestion.label,
    latitude: suggestion.latitude,
    longitude: suggestion.longitude,
  };
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

function blankStop(): StopDraft {
  return { query: "", chosen: null };
}

function draftFromStop(stop: SortieStop): StopDraft {
  return {
    query: stop.label,
    chosen: { label: stop.label, name: stop.label, detail: "", latitude: stop.latitude, longitude: stop.longitude },
  };
}

export function emptyPlaces(): Pick<DialogDraft, "pickup" | "destination" | "waypoints"> {
  return { pickup: blankStop(), destination: blankStop(), waypoints: [] };
}

export function placesFromSortie(stops: SortieStop[]): Pick<DialogDraft, "pickup" | "destination" | "waypoints"> {
  const pickup = stops.find((stop) => stop.role === "pickup");
  const destination = stops.find((stop) => stop.role === "destination");
  return {
    pickup: pickup ? draftFromStop(pickup) : blankStop(),
    destination: destination ? draftFromStop(destination) : blankStop(),
    waypoints: stops.filter((stop) => stop.role === "waypoint").map(draftFromStop),
  };
}

export function sortieTitle(sortie: { label: string; stops: SortieStop[] }): string {
  const label = sortie.label.trim();
  if (label.length > 0) {
    return label;
  }
  return (
    sortie.stops.find((stop) => stop.role === "pickup")?.label ??
    sortie.stops.find((stop) => stop.role === "destination")?.label ??
    ""
  );
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
  arrivalRow: {
    flexDirection: "row",
  },
  arrivalHalf: {
    width: "50%",
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
    width: "100%",
  },
  pickerValue: {
    fontSize: 16,
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
  message: {
    marginTop: 8,
    fontSize: 16,
  },
});
