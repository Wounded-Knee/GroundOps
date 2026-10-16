import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { withAlpha } from "./theme";
import { alertEdges, normalizeThrobCount, THROB_MS, type AlertSide } from "./visualAlertThrob";

const STOPS = 8;

type ThrobHandler = (count: number, side: AlertSide) => void;

let throbHandler: ThrobHandler | null = null;

/** Run `count` consecutive throbs. `side` selects which edges pulse. */
export function throb(count: number, side: AlertSide = "all"): void {
  const n = normalizeThrobCount(count);
  if (n === 0) {
    return;
  }
  throbHandler?.(n, side);
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
  const [throbSide, setThrobSide] = useState<AlertSide>("all");
  const opacity = useRef(new Animated.Value(1)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    throbHandler = (count, side) => {
      animation.current?.stop();
      setThrobSide(side);
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

  const displayIntensity = throbbing ? 0.5 : Math.max(0, Math.min(1, intensity));
  const displayBrightness = throbbing ? 1 : Math.max(0, Math.min(1, brightness));
  const depth = displayIntensity * (Math.min(width, height) / 2);
  if (depth <= 0 || displayBrightness <= 0) {
    return null;
  }
  const edges = alertEdges(throbbing ? throbSide : "all");
  return (
    <Animated.View
      style={[styles.root, { opacity: throbbing ? opacity : 1 }]}
      pointerEvents="none"
    >
      {edges.top ? (
        <View
          pointerEvents="none"
          style={[
            styles.edge,
            { top: 0, left: 0, right: 0, height: depth },
            gradientStyle(edgeFade(color, displayBrightness, "to bottom")),
          ]}
        />
      ) : null}
      {edges.bottom ? (
        <View
          pointerEvents="none"
          style={[
            styles.edge,
            { bottom: 0, left: 0, right: 0, height: depth },
            gradientStyle(edgeFade(color, displayBrightness, "to top")),
          ]}
        />
      ) : null}
      {edges.left ? (
        <View
          pointerEvents="none"
          style={[
            styles.edge,
            { top: 0, bottom: 0, left: 0, width: depth },
            gradientStyle(edgeFade(color, displayBrightness, "to right")),
          ]}
        />
      ) : null}
      {edges.right ? (
        <View
          pointerEvents="none"
          style={[
            styles.edge,
            { top: 0, bottom: 0, right: 0, width: depth },
            gradientStyle(edgeFade(color, displayBrightness, "to left")),
          ]}
        />
      ) : null}
    </Animated.View>
  );
}

/** Quadratic rim fade: full brightness at the outer edge, transparent at the inner edge. */
function edgeFade(
  color: string,
  brightness: number,
  direction: "to bottom" | "to top" | "to right" | "to left",
): string {
  const stops = Array.from({ length: STOPS }, (_, index) => {
    const t = 1 - index / (STOPS - 1);
    const alpha = brightness * t * t;
    const pct = (index / (STOPS - 1)) * 100;
    return `${withAlpha(color, alpha)} ${pct}%`;
  });
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

function gradientStyle(image: string): ViewStyle {
  if (Platform.OS === "web") {
    return { backgroundImage: image } as ViewStyle;
  }
  return { experimental_backgroundImage: image };
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
  },
  edge: {
    position: "absolute",
  },
});
