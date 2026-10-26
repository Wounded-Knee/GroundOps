import type { GeoCoordinate, PlaceSuggestion } from "@groundops/contracts";
import * as Location from "expo-location";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import {
  matchLocalAddresses,
  samePlace,
  withoutDuplicatePlaces,
  type LocalSuggestion,
} from "./addressBookMatch";
import {
  ensureAddressBookLoaded,
  getAddressBookSnapshot,
  refreshDeviceAddresses,
  subscribeAddressBook,
  type AddressBookSnapshot,
} from "./addressBookStore";
import { resolveApiUrl } from "./apiUrl";
import { phoneAddressSubtitle } from "./phoneAddress";
import { geocodePostal } from "./phoneGeocode";
import { parsePlaceQuery } from "./placeQuery";
import { requestPlaceSuggestions } from "./routingClient";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";

const apiUrl = resolveApiUrl();

export function AddressPicker({
  label,
  placeholder,
  query,
  token,
  bias,
  appearance,
  listMaxHeight,
  autoFocus = false,
  savedTitle = false,
  onQueryChange,
  onSelect,
  onUnauthorized,
  onSearchFailed,
}: {
  label?: string;
  placeholder?: string;
  query: string;
  token: string;
  bias?: GeoCoordinate | null;
  appearance: "field" | "search";
  /** Caps the search suggestion list so it stays above the status stack. */
  listMaxHeight?: number;
  autoFocus?: boolean;
  /** A saved place keeps the nickname the driver picked as its destination label. */
  savedTitle?: boolean;
  onQueryChange: (query: string) => void;
  onSelect: (suggestion: PlaceSuggestion) => void;
  onUnauthorized: () => void;
  onSearchFailed?: () => void;
}) {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const styles = createStyles(colors);
  const inputRef = useRef<TextInput>(null);
  const generation = useRef(0);
  const settledLabel = useRef<string | null>(query.trim().length > 0 ? query : null);
  const biasProvided = bias !== undefined;
  const [deviceBias, setDeviceBias] = useState<GeoCoordinate | null>(null);
  const activeBias = biasProvided ? bias : deviceBias;
  const biasRef = useRef<GeoCoordinate | null>(activeBias);
  biasRef.current = activeBias;
  const sawBias = useRef(activeBias !== null);
  const [biasEpoch, setBiasEpoch] = useState(0);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const onSearchFailedRef = useRef(onSearchFailed);
  onSearchFailedRef.current = onSearchFailed;
  const book = useSyncExternalStore(subscribeAddressBook, getAddressBookSnapshot, getAddressBookSnapshot);
  const [rows, setRows] = useState<ShownRow[]>([]);
  const [suggestionContentHeight, setSuggestionContentHeight] = useState(0);

  useEffect(() => {
    if (biasProvided) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted || cancelled) {
          return;
        }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) {
          return;
        }
        setDeviceBias({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      } catch {
        // Search continues without a bias when the device location is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [biasProvided]);

  const hasBias = activeBias !== null;
  useEffect(() => {
    if (!hasBias || sawBias.current) {
      return;
    }
    sawBias.current = true;
    setBiasEpoch(1);
  }, [hasBias]);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [autoFocus]);

  useEffect(() => {
    void ensureAddressBookLoaded(apiUrl, token);
    void refreshDeviceAddresses();
  }, [token]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      generation.current += 1;
      settledLabel.current = null;
      setRows([]);
      return;
    }
    if (query === settledLabel.current) {
      generation.current += 1;
      setRows([]);
      return;
    }
    settledLabel.current = null;
    const requestId = ++generation.current;
    const direct = parsePlaceQuery(trimmed, biasRef.current);
    const local = matchLocalAddresses(trimmed, book.entries, phoneSources(book));
    setRows(shownRows(direct, local));
    const handle = setTimeout(() => {
      void (async () => {
        const result = await requestPlaceSuggestions(apiUrl, token, trimmed, biasRef.current);
        if (generation.current !== requestId) {
          return;
        }
        const currentBook = getAddressBookSnapshot();
        const freshDirect = parsePlaceQuery(trimmed, biasRef.current);
        const fresh = matchLocalAddresses(trimmed, currentBook.entries, phoneSources(currentBook));
        if (result === "unauthorized") {
          onUnauthorizedRef.current();
          return;
        }
        if (result === "failed") {
          setRows(shownRows(freshDirect, fresh));
          if (!freshDirect && fresh.length === 0) {
            onSearchFailedRef.current?.();
          }
          return;
        }
        const remote = withoutDuplicatePlaces(result, fresh).filter(
          (place) => !freshDirect || !samePlace(place, freshDirect),
        );
        setRows(shownRows(freshDirect, fresh, remote));
      })();
    }, 300);
    return () => {
      clearTimeout(handle);
    };
  }, [query, token, biasEpoch, book]);

  function choose(suggestion: PlaceSuggestion): void {
    settledLabel.current = suggestion.label;
    generation.current += 1;
    setRows([]);
    onSelect(suggestion);
  }

  function choosePhone(row: Extract<ShownRow, { kind: "phone" }>): void {
    const requestId = generation.current;
    void (async () => {
      const coordinate = await geocodePostal(row.contactId, row.addressId, row.postal);
      if (generation.current !== requestId) {
        return;
      }
      if (coordinate === "failed") {
        onSearchFailedRef.current?.();
        return;
      }
      choose({
        name: row.name,
        label: row.postal,
        detail: row.detail,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      });
    })();
  }

  function clear(): void {
    settledLabel.current = null;
    generation.current += 1;
    setRows([]);
    onQueryChange("");
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  const suggestionMax = listMaxHeight ?? Math.max(120, windowHeight * 0.35);
  const suggestionHeight =
    suggestionContentHeight > 0 ? Math.min(suggestionContentHeight, suggestionMax) : undefined;
  const suggestions = rows.map((row) => (
    <Pressable
      key={row.key}
      onPress={() => {
        if (row.kind === "phone") {
          choosePhone(row);
          return;
        }
        const suggestion =
          savedTitle && row.saved ? { ...row.suggestion, label: row.suggestion.name } : row.suggestion;
        choose(suggestion);
      }}
      style={appearance === "field" ? styles.fieldSuggestion : styles.searchSuggestion}
    >
      <Text style={styles.suggestionText}>{row.name}</Text>
      {row.detail.length > 0 ? <Text style={styles.suggestionDetail}>{row.detail}</Text> : null}
    </Pressable>
  ));

  return (
    <View style={appearance === "search" ? styles.searchRoot : null}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={appearance === "field" ? styles.fieldRow : styles.searchRow}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onQueryChange}
          onSubmitEditing={() => {
            const direct = parsePlaceQuery(query, biasRef.current);
            if (direct) {
              choose(direct);
            }
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          underlineColorAndroid="transparent"
          style={appearance === "field" ? styles.fieldInput : styles.searchInput}
        />
        <Pressable onPress={clear} accessibilityLabel="Clear" style={styles.clear}>
          <Text style={styles.clearText}>x</Text>
        </Pressable>
      </View>
      {appearance === "search" ? (
        suggestions.length > 0 ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={[
              styles.suggestionScroll,
              { maxHeight: suggestionMax },
              suggestionHeight !== undefined ? { height: suggestionHeight } : null,
            ]}
            nestedScrollEnabled
            onContentSizeChange={(_width, height) => {
              const next = Math.ceil(height);
              setSuggestionContentHeight((current) => (current === next ? current : next));
            }}
          >
            {suggestions}
          </ScrollView>
        ) : null
      ) : (
        suggestions
      )}
    </View>
  );
}

type ShownRow =
  | { kind: "place"; key: string; name: string; detail: string; suggestion: PlaceSuggestion; saved?: boolean }
  | { kind: "phone"; key: string; name: string; detail: string; contactId: string; addressId: string; postal: string };

function phoneSources(book: AddressBookSnapshot) {
  const stars = new Set(book.phoneStars.map((star) => `${star.contactId}\n${star.addressId}`));
  return book.phones.map((phone) => ({
    contactId: phone.contactId,
    addressId: phone.addressId,
    name: phone.name,
    postal: phone.postal,
    addressLabel: phone.addressLabel,
    starred: stars.has(`${phone.contactId}\n${phone.addressId}`),
  }));
}

function shownRows(
  direct: PlaceSuggestion | null,
  local: LocalSuggestion[],
  remote: PlaceSuggestion[] = [],
): ShownRow[] {
  return [...(direct ? [placeRow(direct)] : []), ...rowsFromLocal(local), ...remote.map(placeRow)];
}

function rowsFromLocal(local: LocalSuggestion[]): ShownRow[] {
  return local.map((hit) => {
    if (hit.source === "entry") {
      return { ...placeRow(hit.suggestion), saved: true };
    }
    return {
      kind: "phone",
      key: `phone:${hit.contactId}:${hit.addressId}`,
      name: hit.name,
      detail: phoneAddressSubtitle(hit),
      contactId: hit.contactId,
      addressId: hit.addressId,
      postal: hit.postal,
    };
  });
}

function placeRow(suggestion: PlaceSuggestion): ShownRow {
  return {
    kind: "place",
    key: `${suggestion.label}:${suggestion.latitude}:${suggestion.longitude}`,
    name: suggestion.name,
    detail: suggestion.detail,
    suggestion,
  };
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    searchRoot: {
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
    },
    suggestionScroll: {
      flexGrow: 0,
      flexShrink: 1,
      minHeight: 0,
    },
    label: {
      color: colors.text,
      fontSize: 14,
      marginTop: 4,
    },
    fieldRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 8,
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "transparent",
    },
    fieldInput: {
      flex: 1,
      color: colors.text,
      backgroundColor: colors.surface,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      backgroundColor: "transparent",
      fontSize: 18,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    clear: {
      backgroundColor: "transparent",
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    clearText: {
      fontSize: 18,
      color: colors.text,
    },
    fieldSuggestion: {
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderStrong,
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    searchSuggestion: {
      backgroundColor: "transparent",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderStrong,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    suggestionText: {
      color: colors.text,
      fontSize: 16,
    },
    suggestionDetail: {
      color: colors.textMuted,
      fontSize: 14,
    },
  });
}
