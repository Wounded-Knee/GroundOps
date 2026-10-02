import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import { withAlpha } from "./theme";
import { normalizeThrobCount, THROB_MS } from "./visualAlertThrob";

const BANDS = 8;

type ThrobHandler = (count: number) => void;

let throbHandler: ThrobHandler | null = null;

/** Run `count` consecutive 0.75s throbs (brightness 0→100%→0 at full intensity). */
export function throb(count: number): void {
  const n = normalizeThrobCount(count);
  if (n === 0) {
    return;
  }
  throbHandler?.(n);
}

export { normalizeThrobCount } from "./visualAlertThrob";

export function VisualAlert({
  color,
  intensity,
  brightness,
  enabled,
}: {
  color: string;
  intensity: number;
  brightness: number;
  enabled: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const [throbbing, setThrobbing] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    throbHandler = (count) => {
      animation.current?.stop();
      setThrobbing(true);
      opacity.setValue(0);
      const pulses = Array.from({ length: count }, () =>
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 1,
            duration: THROB_MS / 2,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: THROB_MS / 2,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      const sequence = Animated.sequence(pulses);
      animation.current = sequence;
      sequence.start(({ finished }) => {
        if (!finished) {
          return;
        }
        animation.current = null;
        setThrobbing(false);
        opacity.setValue(1);
      });
    };
    return () => {
      throbHandler = null;
      animation.current?.stop();
      animation.current = null;
    };
  }, [opacity]);

  if (!enabled && !throbbing) {
    return null;
  }

  const displayIntensity = throbbing ? 1 : Math.max(0, Math.min(1, intensity));
  const displayBrightness = throbbing ? 1 : Math.max(0, Math.min(1, brightness));
  const depth = displayIntensity * (Math.min(width, height) / 2);
  if (depth <= 0 || displayBrightness <= 0) {
    return null;
  }
  const band = depth / BANDS;

  return (
    <Animated.View
      style={[styles.root, { opacity: throbbing ? opacity : 1 }]}
      pointerEvents="none"
    >
      {Array.from({ length: BANDS }, (_, index) => {
        const t = 1 - index / (BANDS - 1);
        const bandAlpha = displayBrightness * t * t;
        const backgroundColor = withAlpha(color, bandAlpha);
        const inset = index * band;
        return (
          <View key={index} style={styles.layer} pointerEvents="none">
            <View
              style={[styles.edge, { top: inset, left: 0, right: 0, height: band, backgroundColor }]}
            />
            <View
              style={[
                styles.edge,
                { bottom: inset, left: 0, right: 0, height: band, backgroundColor },
              ]}
            />
            <View
              style={[
                styles.edge,
                { top: 0, bottom: 0, left: inset, width: band, backgroundColor },
              ]}
            />
            <View
              style={[
                styles.edge,
                { top: 0, bottom: 0, right: inset, width: band, backgroundColor },
              ]}
            />
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
  },
  layer: {
    ...StyleSheet.absoluteFill,
  },
  edge: {
    position: "absolute",
  },
});
