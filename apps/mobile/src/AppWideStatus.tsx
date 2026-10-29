import { StyleSheet, View } from "react-native";
import { AvailabilityStatus } from "./AvailabilityStatus";
import type { MeterDisplay } from "./meterDisplay";
import { MeterStrip } from "./MeterStrip";
import { progressFraction } from "./meter";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";

export function AppWideStatus({
  reading,
  current,
  loaded,
  busy,
  message,
  onToggleAvailability,
  onEndSortie,
  onArrive,
  onPlusOneMinute,
  onOnwardDestination,
  onCommenceNext,
}: {
  reading: MeterDisplay | null;
  current: boolean;
  loaded: boolean;
  busy: boolean;
  message: string | null;
  onToggleAvailability: () => void;
  onEndSortie: () => void;
  onArrive: () => void;
  onPlusOneMinute: () => void;
  onOnwardDestination: () => void;
  onCommenceNext: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const turnFill = reading ? progressFraction(reading.turnRemainingMeters, reading.turnBaselineMeters) : 0;
  const tripFill = reading ? progressFraction(reading.remainingMeters, reading.baselineRemainingMeters) : 0;
  return (
    <View>
      {reading ? (
        <MeterStrip
          reading={reading}
          onEndSortie={onEndSortie}
          onArrive={onArrive}
          onPlusOneMinute={onPlusOneMinute}
          onOnwardDestination={onOnwardDestination}
          onCommenceNext={onCommenceNext}
        />
      ) : null}
      {reading ? (
        <View>
          <View style={styles.turnTrack}>
            <View style={[styles.barFill, { width: `${turnFill * 100}%` }]} />
          </View>
          <View style={styles.tripTrack}>
            <View style={[styles.barFill, { width: `${tripFill * 100}%` }]} />
          </View>
        </View>
      ) : null}
      <AvailabilityStatus current={current} loaded={loaded} busy={busy} message={message} onToggle={onToggleAvailability} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
