/* eslint-disable import/first */
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  buttons: new Set<string>(),
  menuItems: new Set<string>(),
  handlers: new Map<string, () => void>(),
  frame: { index: 0, values: [] as unknown[] },
  modal: undefined as any,
  modalView: undefined as any,
}));
function element({ children }: any) {
  return createElement("div", null, children);
}
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = m.frame.index++;
      if (!(index in m.frame.values)) m.frame.values[index] = initial;
      return [
        m.frame.values[index],
        (value: unknown) => {
          m.frame.values[index] =
            typeof value === "function"
              ? (value as (current: unknown) => unknown)(m.frame.values[index])
              : value;
        },
      ];
    },
  };
});
vi.mock("@expo/vector-icons/MaterialIcons", () => ({ default: () => null }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("../hooks/use-recording-personal-metadata", () => ({
  useRecordingPersonalMetadata: vi.fn(),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Modal: (props: any) => {
    m.modal = props;
    return props.visible ? element({ children: props.children }) : null;
  },
  ScrollView: element,
  Share: { share: vi.fn() },
  Text: element,
  TextInput: () => null,
  TouchableOpacity: ({
    children,
    accessibilityLabel,
    accessibilityRole,
    onPress,
  }: any) => {
    if (accessibilityLabel) {
      m.buttons.add(accessibilityLabel);
      m.handlers.set(accessibilityLabel, onPress);
    }
    if (accessibilityLabel && accessibilityRole === "menuitem")
      m.menuItems.add(accessibilityLabel);
    return createElement("button", null, children);
  },
  View: (props: any) => {
    if (props.accessibilityViewIsModal) m.modalView = props;
    return element(props);
  },
}));

import { SummaryActionsView } from "../components/cloud-recordings/summary-actions";

const colors = {
  foreground: "#111",
  muted: "#666",
  primary: "#06c",
  border: "#ddd",
  surface: "#eee",
  background: "#fff",
  error: "#c00",
};
const base = {
  title: "Call with Somchai",
  startedAt: 1,
  original: { summary: "Original summary", actionItems: [] },
  content: { summary: "Original summary", actionItems: [] },
  // Legacy data may retain this compatibility field, but it has no UI.
  personal: { billable: true, updatedAt: 0 },
  ready: true,
  selectedLanguage: "original" as const,
  onOriginal: vi.fn(),
  onUpdate: vi.fn(async () => true),
  colors,
};
function render(props: any = base) {
  m.frame.index = 0;
  m.modal = undefined;
  m.modalView = undefined;
  return renderToStaticMarkup(createElement(SummaryActionsView, props));
}
function resetView() {
  m.frame = { index: 0, values: [] };
  m.buttons.clear();
  m.menuItems.clear();
  m.handlers.clear();
}

it("keeps secondary summary tools behind one compact overflow action", () => {
  resetView();
  const html = render();
  expect(html).toContain("More summary actions");
  expect(m.buttons).toEqual(new Set(["More summary actions"]));
  expect(html).not.toContain(">Copy<");
  expect(html).not.toContain(">Billable<");
  expect(html).not.toContain("Was this summary accurate?");
});

it("opens a compact accessible bottom menu with vertical action rows", () => {
  resetView();
  render();
  m.handlers.get("More summary actions")?.();
  m.buttons.clear();
  m.menuItems.clear();
  render();
  expect(m.modal).toMatchObject({
    visible: true,
    transparent: true,
    presentationStyle: "overFullScreen",
  });
  expect(m.modalView.accessibilityViewIsModal).toBe(true);
  expect(m.modalView.accessibilityRole).toBe("menu");
  expect(m.modalView.style).toMatchObject({
    maxHeight: "80%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  });
  expect(m.menuItems).toEqual(
    new Set([
      "Copy",
      "Share",
      "Export",
      "Edit personal summary",
      "Translate",
      "Save task",
    ]),
  );
  expect(m.buttons).toContain("Close summary actions");
});

it("does not duplicate translated content when the parent panel renders it", () => {
  resetView();
  const translated = {
    ...base,
    selectedLanguage: "th" as const,
    content: { summary: "ภาษาไทยฉบับแปล", actionItems: [] },
    showTranslatedContent: false,
  };
  expect(render(translated)).not.toContain("ภาษาไทยฉบับแปล");
  expect(
    render({
      ...translated,
      showTranslatedContent: true,
    }),
  ).toContain("ภาษาไทยฉบับแปล");
});

it("shows progress only beside the language being translated", () => {
  resetView();
  render({ ...base, onTranslate: vi.fn(async () => undefined) });
  m.handlers.get("More summary actions")?.();
  render({ ...base, onTranslate: vi.fn(async () => undefined) });
  m.handlers.get("Translate")?.();
  const html = render({
    ...base,
    translatingLanguage: "th",
    onTranslate: vi.fn(async () => undefined),
  });
  expect(html.match(/Translating…/gu)).toHaveLength(1);
});

it("does not request every language when the translation picker opens", () => {
  resetView();
  const onTranslate = vi.fn(async () => undefined);
  render({ ...base, onTranslate });
  m.handlers.get("More summary actions")?.();
  render({ ...base, onTranslate });
  m.handlers.get("Translate")?.();
  const html = render({ ...base, onTranslate });
  expect(onTranslate).not.toHaveBeenCalled();
  expect(html).toContain(
    "Choose one language. The original call stays unchanged.",
  );
  m.handlers.get("Show ไทย")?.();
  expect(onTranslate).toHaveBeenCalledWith("th");
  expect(onTranslate).toHaveBeenCalledTimes(1);
});

it("returns from the language picker to the summary actions menu", () => {
  resetView();
  render({ ...base, onTranslate: vi.fn(async () => undefined) });
  m.handlers.get("More summary actions")?.();
  render({ ...base, onTranslate: vi.fn(async () => undefined) });
  m.handlers.get("Translate")?.();
  render({ ...base, onTranslate: vi.fn(async () => undefined) });
  expect(m.buttons).toContain("Back to summary actions");
  m.handlers.get("Back to summary actions")?.();
  m.menuItems.clear();
  render({ ...base, onTranslate: vi.fn(async () => undefined) });
  expect(m.menuItems).toContain("Translate");
});

it("shows a recoverable translation error beside the language choices", () => {
  resetView();
  render({ ...base, onTranslate: vi.fn(async () => undefined) });
  m.handlers.get("More summary actions")?.();
  render({ ...base, onTranslate: vi.fn(async () => undefined) });
  m.handlers.get("Translate")?.();
  const html = render({
    ...base,
    translationError: "Translation is unavailable. Please try again.",
    onTranslate: vi.fn(async () => undefined),
  });
  expect(html).toContain("Translation is unavailable. Please try again.");
});

it("marks only the failed language as retryable", () => {
  resetView();
  render({ ...base, onTranslate: vi.fn(async () => undefined) });
  m.handlers.get("More summary actions")?.();
  render({ ...base, onTranslate: vi.fn(async () => undefined) });
  m.handlers.get("Translate")?.();
  const html = render({
    ...base,
    onTranslate: vi.fn(async () => undefined),
    translationErrorLanguage: "th",
  });
  expect(html.match(/Could not translate/gu)).toHaveLength(1);
  expect(html.match(/>Retry</gu)).toHaveLength(1);
});
