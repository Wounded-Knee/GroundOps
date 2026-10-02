import type { Tariff } from "@groundops/contracts";
import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { formatSeconds } from "./guidance";
import {
  formatMiles,
  formatMoney,
  formatWaitMinutes,
  meterCharges,
  progressFraction,
} from "./meter";
import { useTheme } from "./ThemeProvider";
import { withAlpha, type ThemeColors } from "./theme";

const metersPerMile = 1609.344;

export type MeterDisplay = {
  milesTraveled: number;
  waitSeconds: number;
  remainingMeters: number;
  baselineRemainingMeters: number;
  estimatedDurationSeconds: number;
  turnRemainingMeters: number;
  turnBaselineMeters: number;
  tariff: Tariff | null;
};

export function MeterStrip({
  reading,
  onEndSortie,
}: {
  reading: MeterDisplay;
  onEndSortie: () => void;
}) {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const styles = createStyles(colors);
  const [actionsOpen, setActionsOpen] = useState(false);
  const charges = meterCharges(
    reading.tariff,
    reading.milesTraveled,
    reading.waitSeconds,
    reading.remainingMeters,
  );
  const tripFill = progressFraction(reading.remainingMeters, reading.baselineRemainingMeters);
  const turnFill = progressFraction(reading.turnRemainingMeters, reading.turnBaselineMeters);
  const actualFare = charges ? formatMoney(charges.totalCents) : "—";
  const estimatedFare = charges ? formatMoney(charges.estimateCents) : "—";
  const estimatedMiles =
    reading.milesTraveled + Math.max(0, reading.remainingMeters) / metersPerMile;

  return (
    <Pressable
      accessibilityLabel={actionsOpen ? "Meter actions" : "Meter"}
      onPress={() => setActionsOpen((open) => !open)}
      style={[styles.panel, { height: windowHeight * 0.25 }]}
    >
      {actionsOpen ? (
        <View style={styles.actionsContent}>
          <Pressable
            accessibilityLabel="End Sortie"
            onPress={onEndSortie}
            style={styles.endButton}
          >
            <Text style={styles.endButtonText}>End Sortie</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.content}>
            <View style={styles.sideColumn}>
              <Text style={styles.sideHeading}>Estimated</Text>
              <SideRow label="Miles" value={`${formatMiles(estimatedMiles)} mi`} />
              <SideRow label="Time" value={formatSeconds(reading.estimatedDurationSeconds)} />
              <SideRow label="Fare" value={estimatedFare} />
            </View>
            <View style={styles.heroColumn}>
              <Text
                style={styles.heroFare}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.35}
              >
                {actualFare}
              </Text>
            </View>
            <View style={[styles.sideColumn, styles.sideColumnRight]}>
              <Text style={[styles.sideHeading, styles.alignRight]}>Actual</Text>
              <SideRow
                align="right"
                label="Miles"
                value={`${formatMiles(reading.milesTraveled)} mi`}
              />
              <SideRow
                align="right"
                label="Time"
                value={`${formatWaitMinutes(reading.waitSeconds)} min`}
              />
              <SideRow align="right" label="Fare" value={actualFare} />
            </View>
          </View>
          <View style={styles.turnTrack}>
            <View style={[styles.barFill, { width: `${turnFill * 100}%` }]} />
          </View>
          <View style={styles.tripTrack}>
            <View style={[styles.barFill, { width: `${tripFill * 100}%` }]} />
          </View>
        </>
      )}
    </Pressable>
  );
}

function SideRow({
  label,
  value,
  align = "left",
}: {
  label: string;
  value: string;
  align?: "left" | "right";
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const right = align === "right";
  return (
    <View style={[styles.sideRow, right ? styles.alignRightBlock : null]}>
      <Text style={[styles.sideLabel, right ? styles.alignRight : null]}>{label}</Text>
      <Text style={[styles.sideValue, right ? styles.alignRight : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    panel: {
      backgroundColor: withAlpha(colors.surface, 0.3),
      zIndex: 5,
      overflow: "hidden",
    },
    content: {
      flex: 1,
      flexDirection: "row",
      alignItems: "stretch",
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 4,
      gap: 6,
    },
    actionsContent: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
    },
    endButton: {
      backgroundColor: colors.accent,
      borderRadius: 12,
      paddingVertical: 18,
      paddingHorizontal: 28,
      minWidth: "70%",
      alignItems: "center",
    },
    endButtonText: {
      color: "#fff",
      fontSize: 20,
      fontWeight: "700",
    },
    sideColumn: {
      flex: 1,
      justifyContent: "center",
      gap: 2,
      minWidth: 0,
    },
    sideColumnRight: {
      alignItems: "flex-end",
    },
    sideHeading: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 2,
    },
    sideRow: {
      gap: 0,
    },
    alignRightBlock: {
      alignItems: "flex-end",
      width: "100%",
    },
    alignRight: {
      textAlign: "right",
    },
    sideLabel: {
      fontSize: 11,
      color: colors.textMuted,
    },
    sideValue: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
    },
    heroColumn: {
      flex: 1.4,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 0,
      alignSelf: "stretch",
    },
    heroFare: {
      flex: 1,
      fontSize: 72,
      fontWeight: "800",
      color: colors.text,
      textAlign: "center",
      textAlignVertical: "center",
      width: "100%",
    },
    turnTrack: {
      height: 8,
      backgroundColor: colors.accentSoft,
      overflow: "hidden",
    },
    tripTrack: {
      height: 16,
      backgroundColor: colors.accentSoft,
      overflow: "hidden",
    },
    barFill: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.accent,
      width: "0%",
    },
  });
}
