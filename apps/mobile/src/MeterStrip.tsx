import type { Tariff } from "@groundops/contracts";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  formatMiles,
  formatMoney,
  formatWaitClock,
  formatWaitMinutes,
  meterCharges,
  progressFraction,
} from "./meter";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";

export type MeterDisplay = {
  milesTraveled: number;
  waitSeconds: number;
  remainingMeters: number;
  baselineRemainingMeters: number;
  tariff: Tariff | null;
};

export function MeterStrip({
  reading,
  onPress,
}: {
  reading: MeterDisplay;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const charges = meterCharges(
    reading.tariff,
    reading.milesTraveled,
    reading.waitSeconds,
    reading.remainingMeters,
  );
  const fill = progressFraction(reading.remainingMeters, reading.baselineRemainingMeters);
  const fare = charges ? formatMoney(charges.totalCents) : "—";
  return (
    <Pressable accessibilityLabel="Meter" onPress={onPress} style={styles.track}>
      <View style={[styles.fill, { width: `${fill * 100}%` }]} />
      <Text style={styles.text} numberOfLines={1}>
        {formatMiles(reading.milesTraveled)} mi · {formatWaitMinutes(reading.waitSeconds)} min · {fare}
      </Text>
    </Pressable>
  );
}

export function MeterOverlay({
  reading,
  onClose,
}: {
  reading: MeterDisplay;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const charges = meterCharges(
    reading.tariff,
    reading.milesTraveled,
    reading.waitSeconds,
    reading.remainingMeters,
  );
  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Text style={styles.title}>Meter</Text>
        <Row label="Miles traveled" value={`${formatMiles(reading.milesTraveled)} mi`} />
        <Row label="Wait" value={formatWaitClock(reading.waitSeconds)} />
        <Row label="Miles remaining" value={`${formatMiles(Math.max(0, reading.remainingMeters) / 1609.344)} mi`} />
        {charges ? (
          <>
            <Row label="Flag" value={formatMoney(charges.flagCents)} />
            <Row label="Distance charge" value={formatMoney(charges.distanceCents)} />
            <Row label="Wait charge" value={formatMoney(charges.waitCents)} />
            <Row
              label="Per mile"
              value={formatMoney(reading.tariff?.perMileCents ?? 0)}
            />
            <Row
              label="Per wait minute"
              value={formatMoney(reading.tariff?.perWaitMinuteCents ?? 0)}
            />
            <Row label="Total" value={formatMoney(charges.totalCents)} />
            <Row label="Trip estimate" value={formatMoney(charges.estimateCents)} />
          </>
        ) : (
          <Text style={styles.unavailable}>The fare could not be calculated.</Text>
        )}
        <Pressable onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    track: {
      height: 20,
      backgroundColor: colors.accentSoft,
      justifyContent: "center",
      overflow: "hidden",
      zIndex: 5,
    },
    fill: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.accent,
      width: "0%",
    },
    text: {
      position: "absolute",
      left: 8,
      right: 8,
      fontSize: 13,
      lineHeight: 20,
      color: colors.text,
      fontWeight: "600",
      textAlign: "center",
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.overlay,
      justifyContent: "center",
      padding: 24,
      zIndex: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 20,
      gap: 8,
    },
    title: {
      fontSize: 20,
      fontWeight: "600",
      marginBottom: 8,
      color: colors.text,
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
    },
    rowLabel: {
      color: colors.textMuted,
      fontSize: 15,
    },
    rowValue: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "500",
    },
    unavailable: {
      color: colors.textSecondary,
      fontSize: 15,
      marginVertical: 8,
    },
    close: {
      marginTop: 12,
      alignItems: "center",
      paddingVertical: 12,
    },
    closeText: {
      fontSize: 16,
      color: colors.accent,
      fontWeight: "600",
    },
  });
}
