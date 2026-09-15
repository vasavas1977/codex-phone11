import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Appearance, View, useColorScheme as useDeviceColorScheme } from "react-native";
import { colorScheme as nativewindColorScheme, vars } from "nativewind";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { SchemeColors, type ColorScheme } from "@/constants/theme";

export type AppearancePreference = "system" | ColorScheme;
const APPEARANCE_KEY = "@phone11:appearance";

type ThemeContextValue = {
  appearance: AppearancePreference;
  setAppearance: (preference: AppearancePreference) => void;
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const deviceScheme = useDeviceColorScheme();
  const [appearance, setAppearanceState] = useState<AppearancePreference>("system");
  const changedByUser = useRef(false);
  const pendingWrite = useRef(Promise.resolve());
  const colorScheme: ColorScheme = appearance === "system" ? deviceScheme ?? "light" : appearance;

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(APPEARANCE_KEY).then(saved => {
      if (active && !changedByUser.current && (saved === "system" || saved === "light" || saved === "dark")) {
        setAppearanceState(saved);
      }
    }).catch(() => { /* A storage failure must not prevent the app from opening. */ });
    return () => { active = false; };
  }, []);

  const setAppearance = useCallback((preference: AppearancePreference) => {
    changedByUser.current = true;
    setAppearanceState(preference);
    // Serialize quick changes so an older write cannot replace the latest choice.
    pendingWrite.current = pendingWrite.current
      .then(() => AsyncStorage.setItem(APPEARANCE_KEY, preference))
      .catch(() => { /* The current-session choice still works if storage is unavailable. */ });
  }, []);

  useEffect(() => {
    nativewindColorScheme.set(appearance);
    Appearance.setColorScheme?.(appearance === "system" ? null : appearance);
  }, [appearance]);

  const applyScheme = useCallback((scheme: ColorScheme) => {
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.dataset.theme = scheme;
      root.classList.toggle("dark", scheme === "dark");
      const palette = SchemeColors[scheme];
      Object.entries(palette).forEach(([token, value]) => {
        root.style.setProperty(`--color-${token}`, value);
      });
    }
  }, []);

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    setAppearance(scheme);
  }, [setAppearance]);

  useEffect(() => {
    applyScheme(colorScheme);
  }, [applyScheme, colorScheme]);

  const themeVariables = useMemo(
    () =>
      vars({
        "color-primary": SchemeColors[colorScheme].primary,
        "color-background": SchemeColors[colorScheme].background,
        "color-surface": SchemeColors[colorScheme].surface,
        "color-foreground": SchemeColors[colorScheme].foreground,
        "color-muted": SchemeColors[colorScheme].muted,
        "color-border": SchemeColors[colorScheme].border,
        "color-success": SchemeColors[colorScheme].success,
        "color-warning": SchemeColors[colorScheme].warning,
        "color-error": SchemeColors[colorScheme].error,
      }),
    [colorScheme],
  );

  const value = useMemo(
    () => ({
      appearance,
      setAppearance,
      colorScheme,
      setColorScheme,
    }),
    [appearance, setAppearance, colorScheme, setColorScheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1, backgroundColor: SchemeColors[colorScheme].background }, themeVariables]}>
        {children}
      </View>
    </ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return ctx;
}
