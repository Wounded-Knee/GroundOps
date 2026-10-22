import type { PlaceSuggestion, Sortie, SortieStop, SortieStopWrite, SortieWriteRequest } from "@groundops/contracts";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { createElement, useEffect, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AddressPicker } from "./AddressPicker";
import { aestheticAddress } from "./aestheticAddress";
import { resolveApiUrl } from "./apiUrl";
import { previewSortie, scheduleConflictMessage } from "./calendarClient";
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
import { applyPassengerToggle, repairPassengerSpan } from "./passengerSpan";
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
  focusStopIndex?: number | null;
  /** Saved sortie when the dialog is showing calendar facts. Edits stay on the draft. */
  sortie?: Sortie | null;
};

type PickerTarget = "arrival-date" | "arrival-time";

type StopDrag = {
  index: number;
  dy: number;
  target: number;
};

export function SortieDialog({
  draft,
  token,
  message = null,
  onSave,
  onCancel,
  onGuide = null,
  onSaveAddress = null,
  onUnauthorized,
  layout = "modal",
  onScrollLock,
}: {
  draft: DialogDraft;
  token: string;
  message?: string | null;
  onSave: (body: SortieWriteRequest | "invalid") => void;
  onCancel: () => void;
  onGuide?: (() => void) | null;
  onSaveAddress?: ((place: PlaceSuggestion) => void) | null;
  onUnauthorized: () => void;
  layout?: "modal" | "inline";
  onScrollLock?: (locked: boolean) => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [label, setLabel] = useState(draft.label);
  const [labelManual, setLabelManual] = useState(draft.sortieId !== null && draft.label.trim().length > 0);
  const [arrival, setArrival] = useState(draft.arrival);
  const [passengerName, setPassengerName] = useState(draft.passengerName);
  const [phone, setPhone] = useState(draft.phone);
  const [stops, setStops] = useState(draft.stops.length > 0 ? draft.stops : [blankStop()]);
  const [editingIndex, setEditingIndex] = useState<number | null>(draft.focusStopIndex ?? null);
  const [drag, setDrag] = useState<StopDrag | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const gpsSeeded = useRef(false);
  const previewRequest = useRef(0);
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const rowHeights = useRef<number[]>([]);
  const dragRef = useRef<StopDrag | null>(null);
  const scrollLock = useRef(onScrollLock);
  scrollLock.current = onScrollLock;

  useEffect(() => {
    return () => scrollLock.current?.(false);
  }, []);

  useEffect(() => {
    const chosen = previewStops(stops);
    if (chosen.length === 0) {
      previewRequest.current += 1;
      setConflict(null);
      return;
    }
    const requestId = ++previewRequest.current;
    const timer = setTimeout(() => {
      void (async () => {
        const result = await previewSortie(apiUrl, token, {
          label: "",
          arrivalAt: arrival ? arrival.toISOString() : null,
          passengerName: null,
          passengerPhone: null,
          stops: chosen,
          sortieId: draft.sortieId,
        });
        if (requestId !== previewRequest.current) {
          return;
        }
        if (result === "unauthorized") {
          onUnauthorized();
          return;
        }
        if (typeof result === "string") {
          setConflict(null);
          return;
        }
        setConflict(scheduleConflictMessage(result.endangered.map((item) => item.label)));
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [arrival, draft.sortieId, onUnauthorized, stops, token]);

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

  function beginDrag(index: number): void {
    const next = { index, dy: 0, target: index };
    dragRef.current = next;
    setDrag(next);
    setEditingIndex(null);
    scrollLock.current?.(true);
  }

  function moveDrag(index: number, dy: number): void {
    const next = {
      index,
      dy,
      target: indexAtOffset(rowHeights.current, index, dy, stopsRef.current.length),
    };
    dragRef.current = next;
    setDrag(next);
  }

  function endDrag(dy: number | null): void {
    scrollLock.current?.(false);
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current || dy === null) {
      return;
    }
    const to = indexAtOffset(rowHeights.current, current.index, dy, stopsRef.current.length);
    if (to === current.index) {
      return;
    }
    setStops((items) => withRepairedPassengers(moveStop(items, current.index, to)));
  }

  function togglePassenger(index: number): void {
    setStops((current) => withPassengerFlags(current, applyPassengerToggle(current.map((stop) => stop.passenger), index)));
  }

  const pickerMode = picker === "arrival-date" ? "date" : "time";
  const heading = dialogHeading(draft, label, stops);
  const inline = layout === "inline";

  const form = (
    <>
      {inline ? null : <Text style={styles.title}>{heading}</Text>}
        <View>
          {stops.map((stop, index) => (
            <WaypointRow
              key={`stop-${index}`}
              stop={stop}
              index={index}
              count={stops.length}
              token={token}
              canRemove={stops.length > 1}
              editing={editingIndex === index || stop.chosen === null}
              autoFocus={editingIndex === index}
              translateY={rowTranslate(index, drag, rowHeights.current)}
              raised={drag?.index === index}
              incoming={index > 0}
              outgoingPassenger={index < stops.length - 1 ? stops[index + 1]!.passenger : null}
              onLayout={(height) => {
                rowHeights.current[index] = height;
              }}
              onEdit={() => setEditingIndex(index)}
              onChange={(next) => {
                setStops((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
              }}
              onSelect={(next) => {
                setEditingIndex(null);
                setStops((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
              }}
              onRemove={() => {
                setEditingIndex((current) => {
                  if (current === null || current === index) {
                    return null;
                  }
                  return current > index ? current - 1 : current;
                });
                setStops((current) => withRepairedPassengers(current.filter((_, itemIndex) => itemIndex !== index)));
              }}
              onTogglePassenger={() => togglePassenger(index)}
              onDragGrant={() => beginDrag(index)}
              onDragMove={(dy) => moveDrag(index, dy)}
              onDragRelease={endDrag}
              onUnauthorized={onUnauthorized}
              onSaveAddress={onSaveAddress}
            />
          ))}
        </View>
        <Pressable
          onPress={() => {
            setEditingIndex(stops.length);
            setStops((current) => [...current, blankStop()]);
          }}
          style={styles.addStop}
        >
          <Text style={styles.addStopText}>+</Text>
        </Pressable>
        {draft.sortie ? (
          <View style={styles.facts}>
            <Fact label="Start" value={when(draft.sortie.actualStart ?? draft.sortie.scheduledStart)} />
            <Fact
              label="Depart from"
              value={draft.sortie.departureAddress.length > 0 ? draft.sortie.departureAddress : "—"}
            />
            <Fact label="End" value={when(draft.sortie.actualEnd ?? draft.sortie.scheduledEnd)} />
          </View>
        ) : null}
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
        {conflict ? <Text style={styles.message}>{conflict}</Text> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.actionRow}>
          <Pressable onPress={save} style={[styles.primary, styles.action]}>
            <Text style={styles.primaryText}>Save</Text>
          </Pressable>
          {onGuide ? (
            <Pressable onPress={onGuide} style={[styles.primary, styles.action]}>
              <Text style={styles.primaryText}>Guide</Text>
            </Pressable>
          ) : null}
        </View>
        {inline ? null : (
          <Pressable onPress={onCancel} style={styles.secondary}>
            <Text style={styles.secondaryText}>Close</Text>
          </Pressable>
        )}
    </>
  );

  if (inline) {
    return <View style={styles.inlineBody}>{form}</View>;
  }

  return (
    <View style={styles.backdrop}>
      <ScrollView
        contentContainerStyle={styles.card}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={drag === null}
      >
        {form}
      </ScrollView>
    </View>
  );
}

function WaypointRow({
  stop,
  index,
  count,
  token,
  canRemove,
  editing,
  autoFocus,
  translateY,
  raised,
  incoming,
  outgoingPassenger,
  onLayout,
  onEdit,
  onChange,
  onSelect,
  onRemove,
  onTogglePassenger,
  onDragGrant,
  onDragMove,
  onDragRelease,
  onUnauthorized,
  onSaveAddress,
}: {
  stop: StopDraft;
  index: number;
  count: number;
  token: string;
  canRemove: boolean;
  editing: boolean;
  autoFocus: boolean;
  translateY: number;
  raised: boolean;
  incoming: boolean;
  outgoingPassenger: boolean | null;
  onLayout: (height: number) => void;
  onEdit: () => void;
  onChange: (stop: StopDraft) => void;
  onSelect: (stop: StopDraft) => void;
  onRemove: () => void;
  onTogglePassenger: () => void;
  onDragGrant: () => void;
  onDragMove: (dy: number) => void;
  onDragRelease: (dy: number | null) => void;
  onUnauthorized: () => void;
  onSaveAddress: ((place: PlaceSuggestion) => void) | null;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const place = stop.chosen ? aestheticAddress(stop.chosen) : null;
  return (
    <View
      onLayout={(event) => onLayout(event.nativeEvent.layout.height)}
      style={[styles.stop, translateY !== 0 ? { transform: [{ translateY }] } : null, raised ? styles.stopRaised : null]}
    >
      <StopGrip onGrant={onDragGrant} onMove={onDragMove} onRelease={onDragRelease} />
      <TimelineRail passenger={stop.passenger} incoming={incoming} outgoingPassenger={outgoingPassenger} />
      <View style={styles.stopBody}>
        {editing || !place ? (
          <AddressPicker
            appearance="field"
            query={stop.query}
            token={token}
            autoFocus={autoFocus}
            onQueryChange={(query) => {
              const chosen = stop.chosen && stop.chosen.label === query ? stop.chosen : null;
              onChange({ query, chosen, waitMinutes: stop.waitMinutes, passenger: stop.passenger });
            }}
            onSelect={(suggestion) =>
              onSelect({
                query: suggestion.label,
                chosen: suggestion,
                waitMinutes: stop.waitMinutes,
                passenger: stop.passenger,
              })
            }
            onUnauthorized={onUnauthorized}
          />
        ) : (
          <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit address">
            <Text style={styles.addressTitle}>{place.title}</Text>
            {place.subtitle.length > 0 ? <Text style={styles.addressSubtitle}>{place.subtitle}</Text> : null}
          </Pressable>
        )}
        {stop.chosen ? (
          <View style={styles.waitRow}>
            <Text style={styles.waitLabel}>Wait</Text>
            <TextInput
              value={String(stop.waitMinutes)}
              onChangeText={(value) => {
                const digits = value.replace(/\D/g, "");
                onChange({ ...stop, waitMinutes: digits.length === 0 ? 0 : Number(digits) });
              }}
              keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
              inputMode={Platform.OS === "web" ? "numeric" : undefined}
              placeholderTextColor={colors.textMuted}
              style={styles.waitInput}
              accessibilityLabel={`Wait at stop ${index + 1}`}
            />
            {canRemove ? (
              <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel="Remove stop">
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            ) : null}
            {onSaveAddress ? (
              <Pressable
                onPress={() => onSaveAddress(stop.chosen!)}
                accessibilityRole="button"
                accessibilityLabel="Save address"
              >
                <Text style={styles.removeText}>Save address</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={onTogglePassenger}
        style={[styles.passengerToggle, stop.passenger ? styles.passengerToggleOn : null]}
        accessibilityRole="button"
        accessibilityState={{ selected: stop.passenger }}
        accessibilityLabel={`Passenger at stop ${index + 1} of ${count}`}
      >
        <Text style={[styles.passengerToggleText, stop.passenger ? styles.passengerToggleTextOn : null]}>P</Text>
      </Pressable>
    </View>
  );
}

function TimelineRail({
  passenger,
  incoming,
  outgoingPassenger,
}: {
  passenger: boolean;
  incoming: boolean;
  outgoingPassenger: boolean | null;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.rail}>
      {incoming ? (
        <View style={[styles.railLineTop, { backgroundColor: passenger ? colors.accent : colors.borderStrong }]} />
      ) : null}
      {outgoingPassenger !== null ? (
        <View
          style={[styles.railLineBottom, { backgroundColor: outgoingPassenger ? colors.accent : colors.borderStrong }]}
        />
      ) : null}
      <View style={[styles.bubble, { backgroundColor: passenger ? colors.accent : colors.borderStrong }]} />
    </View>
  );
}

function StopGrip({
  onGrant,
  onMove,
  onRelease,
}: {
  onGrant: () => void;
  onMove: (dy: number) => void;
  onRelease: (dy: number | null) => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const latest = useRef({ onGrant, onMove, onRelease });
  latest.current = { onGrant, onMove, onRelease };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => latest.current.onGrant(),
      onPanResponderMove: (_event, gesture) => latest.current.onMove(gesture.dy),
      onPanResponderRelease: (_event, gesture) => latest.current.onRelease(gesture.dy),
      onPanResponderTerminate: () => latest.current.onRelease(null),
    }),
  ).current;
  return (
    <View {...responder.panHandlers} accessibilityRole="button" accessibilityLabel="Reorder stop" style={styles.grip}>
      <Ionicons name="reorder-three" size={22} color={colors.textMuted} />
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
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

function previewStops(drafts: StopDraft[]): SortieStopWrite[] {
  const stops: SortieStopWrite[] = [];
  for (const draft of drafts) {
    const stop = toStop(draft);
    if (stop) {
      stops.push(stop);
    }
  }
  return stops;
}

function chosenStops(drafts: StopDraft[]): SortieStopWrite[] | null {
  if (drafts.length === 0) {
    return null;
  }
  const stops: SortieStopWrite[] = [];
  for (const draft of drafts) {
    const stop = toStop(draft);
    if (!stop) {
      return null;
    }
    stops.push(stop);
  }
  return stops;
}

function toStop(draft: StopDraft): SortieStopWrite | null {
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

export function blankStop(): StopDraft {
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

export function draftForPlace(place: PlaceSuggestion): DialogDraft {
  return {
    sortieId: null,
    label: "",
    arrival: null,
    passengerName: "",
    phone: "",
    stops: [
      {
        query: place.label,
        chosen: place,
        waitMinutes: 0,
        passenger: false,
      },
    ],
  };
}

export function placesFromSortie(stops: SortieStop[]): Pick<DialogDraft, "stops"> {
  const drafts = stops.length > 0 ? stops.map(draftFromStop) : [blankStop()];
  return { stops: withRepairedPassengers(drafts) };
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

function dialogHeading(draft: DialogDraft, label: string, stops: StopDraft[]): string {
  if (draft.sortieId === null) {
    return "Author sortie";
  }
  const titled = sortieTitle({
    label,
    stops: stops.flatMap((stop) => {
      const written = toStop(stop);
      if (!written) {
        return [];
      }
      return [{ ...written, actualArrivedAt: null, actualDepartedAt: null }];
    }),
  });
  return titled.length > 0 ? titled : "Revise sortie";
}

function when(value: string): string {
  const date = new Date(value);
  return `${formatCalendarDate(date)} ${formatCalendarTime(date)}`;
}

function withPassengerFlags(stops: StopDraft[], flags: readonly boolean[]): StopDraft[] {
  let changed = false;
  const next = stops.map((stop, index) => {
    const passenger = flags[index] ?? false;
    if (passenger === stop.passenger) {
      return stop;
    }
    changed = true;
    return { ...stop, passenger };
  });
  return changed ? next : stops;
}

function withRepairedPassengers(stops: StopDraft[]): StopDraft[] {
  return withPassengerFlags(
    stops,
    repairPassengerSpan(stops.map((stop) => stop.passenger)),
  );
}

function moveStop(stops: StopDraft[], from: number, to: number): StopDraft[] {
  if (from === to || from < 0 || to < 0 || from >= stops.length || to >= stops.length) {
    return stops;
  }
  const next = stops.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) {
    return stops;
  }
  next.splice(to, 0, moved);
  return next;
}

function indexAtOffset(heights: readonly number[], from: number, dy: number, count: number): number {
  if (count <= 1) {
    return 0;
  }
  const safe = Array.from({ length: count }, (_, index) => {
    const height = heights[index] ?? 0;
    return height > 0 ? height : 64;
  });
  const fromTop = safe.slice(0, from).reduce((sum, height) => sum + height, 0);
  const center = fromTop + dy + (safe[from] ?? 64) / 2;
  let cursor = 0;
  for (let index = 0; index < safe.length; index += 1) {
    const height = safe[index] ?? 64;
    if (center < cursor + height) {
      return index;
    }
    cursor += height;
  }
  return safe.length - 1;
}

function rowTranslate(index: number, drag: StopDrag | null, heights: readonly number[]): number {
  if (!drag) {
    return 0;
  }
  if (index === drag.index) {
    return drag.dy;
  }
  const measured = heights[drag.index] ?? 0;
  const span = measured > 0 ? measured : 64;
  if (drag.index < drag.target && index > drag.index && index <= drag.target) {
    return -span;
  }
  if (drag.target < drag.index && index >= drag.target && index < drag.index) {
    return span;
  }
  return 0;
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
    inlineBody: {
      gap: 8,
      marginTop: 8,
    },
    title: {
      fontSize: 20,
      color: colors.text,
    },
    stop: {
      flexDirection: "row",
      alignItems: "stretch",
      minHeight: 56,
    },
    stopRaised: {
      zIndex: 2,
      elevation: 3,
    },
    grip: {
      width: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    rail: {
      width: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    railLineTop: {
      position: "absolute",
      top: 0,
      height: "50%",
      width: 2,
    },
    railLineBottom: {
      position: "absolute",
      top: "50%",
      bottom: 0,
      width: 2,
    },
    bubble: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.surface,
      zIndex: 1,
    },
    stopBody: {
      flex: 1,
      minWidth: 0,
      justifyContent: "center",
      paddingVertical: 8,
      gap: 4,
    },
    addressTitle: {
      fontSize: 16,
      color: colors.text,
    },
    addressSubtitle: {
      fontSize: 14,
      color: colors.textMuted,
    },
    waitRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    waitLabel: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    waitInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      fontSize: 16,
      paddingHorizontal: 8,
      paddingVertical: 6,
      minWidth: 64,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    removeText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    passengerToggle: {
      width: 44,
      minHeight: 44,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      backgroundColor: colors.surfaceMuted,
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
    facts: {
      gap: 8,
      marginTop: 8,
    },
    factLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    factValue: {
      fontSize: 16,
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
    actionRow: {
      flexDirection: "row",
      gap: 12,
    },
    action: {
      flex: 1,
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
