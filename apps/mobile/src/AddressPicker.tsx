import type { GeoCoordinate, PlaceSuggestion } from "@groundops/contracts";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { requestPlaceSuggestions } from "./routingClient";

const apiUrl = resolveApiUrl();

export function AddressPicker({
  label,
  placeholder,
  query,
  token,
  bias = null,
  appearance,
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
  onQueryChange: (query: string) => void;
  onSelect: (suggestion: PlaceSuggestion) => void;
  onUnauthorized: () => void;
  onSearchFailed?: () => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const generation = useRef(0);
  const settledLabel = useRef<string | null>(query.trim().length > 0 ? query : null);
  const biasRef = useRef(bias);
  biasRef.current = bias;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const onSearchFailedRef = useRef(onSearchFailed);
  onSearchFailedRef.current = onSearchFailed;
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      generation.current += 1;
      settledLabel.current = null;
      setSuggestions([]);
      return;
    }
    if (query === settledLabel.current) {
      generation.current += 1;
      setSuggestions([]);
      return;
    }
    settledLabel.current = null;
    const requestId = ++generation.current;
    const handle = setTimeout(() => {
      void (async () => {
        const result = await requestPlaceSuggestions(apiUrl, token, trimmed, biasRef.current);
        if (generation.current !== requestId) {
          return;
        }
        if (result === "unauthorized") {
          onUnauthorizedRef.current();
          return;
        }
        if (result === "failed") {
          setSuggestions([]);
          onSearchFailedRef.current?.();
          return;
        }
        setSuggestions(result);
      })();
    }, 300);
    return () => {
      clearTimeout(handle);
    };
  }, [query, token]);

  function choose(suggestion: PlaceSuggestion): void {
    settledLabel.current = suggestion.label;
    generation.current += 1;
    setSuggestions([]);
    onSelect(suggestion);
  }

  function clear(): void {
    settledLabel.current = null;
    generation.current += 1;
    setSuggestions([]);
    onQueryChange("");
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={appearance === "field" ? styles.fieldRow : styles.searchRow}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onQueryChange}
          placeholder={placeholder}
          placeholderTextColor={hint}
          autoCorrect={false}
          underlineColorAndroid="transparent"
          style={appearance === "field" ? styles.fieldInput : styles.searchInput}
        />
        <Pressable onPress={clear} accessibilityLabel="Clear" style={styles.clear}>
          <Text style={styles.clearText}>x</Text>
        </Pressable>
      </View>
      {suggestions.map((suggestion) => (
        <Pressable
          key={`${suggestion.label}:${suggestion.latitude}:${suggestion.longitude}`}
          onPress={() => choose(suggestion)}
          style={appearance === "field" ? styles.fieldSuggestion : styles.searchSuggestion}
        >
          <Text style={styles.suggestionText}>{suggestion.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const ink = "#111111";
const hint = "#595959";
const line = "#767676";
const surface = "#FFFFFF";

const styles = StyleSheet.create({
  label: {
    color: ink,
    fontSize: 14,
    marginTop: 4,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: surface,
    borderWidth: 1,
    borderColor: line,
    borderRadius: 8,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: surface,
  },
  fieldInput: {
    flex: 1,
    color: ink,
    backgroundColor: surface,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  searchInput: {
    flex: 1,
    color: ink,
    backgroundColor: surface,
    fontSize: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  clear: {
    backgroundColor: surface,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  clearText: {
    fontSize: 18,
    color: ink,
  },
  fieldSuggestion: {
    backgroundColor: surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: line,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  searchSuggestion: {
    backgroundColor: surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: line,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  suggestionText: {
    color: ink,
    fontSize: 16,
  },
});
