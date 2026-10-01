import type { GeoCoordinate, PlaceSuggestion } from "@groundops/contracts";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { resolveApiUrl } from "./apiUrl";
import { requestPlaceSuggestions } from "./routingClient";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";

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
  const { colors } = useTheme();
  const styles = createStyles(colors);
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
          placeholderTextColor={colors.textMuted}
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
          <Text style={styles.suggestionText}>{suggestion.name}</Text>
          {suggestion.detail.length > 0 ? <Text style={styles.suggestionDetail}>{suggestion.detail}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
      backgroundColor: colors.surface,
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
      backgroundColor: colors.surface,
      fontSize: 18,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    clear: {
      backgroundColor: colors.surface,
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
      backgroundColor: colors.surface,
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
