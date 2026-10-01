import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import {
  ensureAppearancePreferenceLoaded,
  getAppearancePreference,
  saveAppearancePreference,
  subscribeAppearancePreference,
  type AppearancePreference,
} from "./appearancePrefs";
import { colorsForScheme, type ThemeColors, type ThemeScheme } from "./theme";

type ThemeContextValue = {
  preference: AppearancePreference;
  setPreference: (preference: AppearancePreference) => void;
  scheme: ThemeScheme;
  colors: ThemeColors;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<AppearancePreference>(getAppearancePreference);

  useEffect(() => {
    void ensureAppearancePreferenceLoaded();
    return subscribeAppearancePreference(() => {
      setPreferenceState(getAppearancePreference());
    });
  }, []);

  const scheme: ThemeScheme =
    preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      setPreference: (next) => {
        void saveAppearancePreference(next);
      },
      scheme,
      colors: colorsForScheme(scheme),
    }),
    [preference, scheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme requires ThemeProvider.");
  }
  return value;
}
