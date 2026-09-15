import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  device: "light" as "light" | "dark", values: [] as any[], index: 0,
  effects: [] as (() => any)[], current: null as any,
  getItem: vi.fn(), setItem: vi.fn(), nativeScheme: vi.fn(), appearance: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useState: (initial: any) => { const i = m.index++; if (i >= m.values.length) m.values[i] = initial; return [m.values[i], (v: any) => { m.values[i] = v; }]; },
    useRef: (initial: any) => { const i = m.index++; if (i >= m.values.length) m.values[i] = { current: initial }; return m.values[i]; },
    useEffect: (effect: () => any) => { m.effects.push(effect); },
  };
});
vi.mock("react-native", () => ({
  Appearance: { setColorScheme: (value: any) => m.appearance(value) },
  useColorScheme: () => m.device,
  View: ({ children }: any) => createElement("div", null, children),
}));
vi.mock("nativewind", () => ({ colorScheme: { set: (value: any) => m.nativeScheme(value) }, vars: (x: any) => x }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: (...args: any[]) => m.getItem(...args), setItem: (...args: any[]) => m.setItem(...args) } }));
vi.mock("../constants/theme", () => ({ SchemeColors: { light: { background: "white" }, dark: { background: "black" } } }));
import { ThemeProvider, useThemeContext } from "../lib/theme-provider";
function Probe() { m.current = useThemeContext(); return createElement("span", null, m.current.colorScheme); }
function render() { m.index = 0; m.effects = []; return renderToStaticMarkup(createElement(ThemeProvider, null, createElement(Probe))); }
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
beforeEach(() => { vi.clearAllMocks(); m.device = "light"; m.values = []; m.getItem.mockResolvedValue(null); m.setItem.mockResolvedValue(undefined); });
it("follows device changes by default and resets native override for System", () => {
  expect(render()).toContain("light"); m.effects[1](); expect(m.nativeScheme).toHaveBeenLastCalledWith("system"); expect(m.appearance).toHaveBeenLastCalledWith(null);
  m.device = "dark"; expect(render()).toContain("dark");
  m.current.setAppearance("light"); expect(render()).toContain("light"); m.effects[1](); expect(m.appearance).toHaveBeenLastCalledWith("light");
  m.current.setAppearance("system"); expect(render()).toContain("dark"); m.effects[1](); expect(m.appearance).toHaveBeenLastCalledWith(null);
});
it("restores a saved choice and ignores malformed saved data", async () => {
  m.getItem.mockResolvedValue("dark"); render(); m.effects[0](); await settle(); render(); expect(m.current.appearance).toBe("dark");
  m.values = []; m.getItem.mockResolvedValue("invalid"); render(); m.effects[0](); await settle(); render(); expect(m.current.appearance).toBe("system");
});
it("does not overwrite a new choice when delayed hydration finishes", async () => {
  let resolve!: (value: string) => void; m.getItem.mockReturnValue(new Promise(yes => { resolve = yes; }));
  render(); m.effects[0](); m.current.setAppearance("light"); resolve("dark"); await settle(); render(); expect(m.current.appearance).toBe("light");
});
it("serializes rapid choices and recovers after a failed write", async () => {
  let finish!: () => void; m.setItem.mockReturnValueOnce(new Promise<void>(yes => { finish = yes; })).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
  render(); m.current.setAppearance("dark"); m.current.setAppearance("light"); m.current.setAppearance("system");
  await settle(); expect(m.setItem).toHaveBeenCalledTimes(1); finish(); await settle();
  expect(m.setItem.mock.calls.map(call => call[1])).toEqual(["dark", "light", "system"]);
});
