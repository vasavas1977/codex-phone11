/* eslint-disable import/first */
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  frame: { index: 0, values: [] as unknown[] },
  handlers: new Map<string, () => unknown>(),
  inputs: new Map<string, any>(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState(initial: unknown) {
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
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  TouchableOpacity: ({
    children,
    accessibilityLabel,
    onPress,
    disabled,
  }: any) => {
    if (!disabled) m.handlers.set(accessibilityLabel, onPress);
    return createElement("button", { disabled }, children);
  },
  TextInput: (props: any) => {
    m.inputs.set(props.accessibilityLabel, props);
    return createElement("input", { value: props.value, readOnly: true });
  },
}));
import { SpeakerNamesEditor } from "../components/cloud-recordings/speaker-names-editor";
const base = {
  transcript: "Speaker 1: A first utterance\nSpeaker 2: A second utterance",
  suggestions: ["Nathasa", "Vasavas"],
  ready: true,
  saving: false,
  onSave: vi.fn(async () => true),
  colors: {
    foreground: "#111",
    muted: "#666",
    primary: "#06c",
    border: "#ddd",
    surface: "#eee",
    background: "#fff",
  },
};
function render(props: any = base) {
  m.frame.index = 0;
  m.handlers.clear();
  m.inputs.clear();
  return renderToStaticMarkup(createElement(SpeakerNamesEditor, props));
}
beforeEach(() => {
  m.frame = { index: 0, values: [] };
  base.onSave.mockClear();
});
it("offers only one entry and requires explicit choices before assigning contact suggestions", async () => {
  const html = render();
  expect([...m.handlers.keys()]).toEqual(["Correct speaker labels"]);
  expect(html).not.toContain("Nathasa");
  m.handlers.get("Correct speaker labels")!();
  expect(render()).toContain("A first utterance");
  expect(m.inputs.get("Name for Speaker 1").value).toBe("");
  expect(m.inputs.get("Name for Speaker 2").value).toBe("");
  m.handlers.get("Use Vasavas for Speaker 1")!();
  m.handlers.get("Use Nathasa for Speaker 2")!();
  render();
  expect(m.inputs.get("Name for Speaker 1").value).toBe("Vasavas");
  expect(m.inputs.get("Name for Speaker 2").value).toBe("Nathasa");
  expect(base.onSave).not.toHaveBeenCalled();
  m.handlers.get("Save names")!();
  await Promise.resolve();
  expect(base.onSave).toHaveBeenCalledWith({
    speaker1: "Vasavas",
    speaker2: "Nathasa",
  });
  expect([...m.handlers.keys()]).toContain("Save names");
  render();
  expect([...m.handlers.keys()]).toEqual(["Correct speaker labels"]);
});
it("supports manual correction and clearing without saving a canceled edit", () => {
  const props = { ...base, names: { speaker1: "Original" } };
  render(props);
  m.handlers.get("Correct speaker labels")!();
  render(props);
  m.inputs.get("Name for Speaker 1").onChangeText("Corrected");
  render(props);
  expect(m.inputs.get("Name for Speaker 1").value).toBe("Corrected");
  m.handlers.get("Clear names")!();
  render(props);
  expect(m.inputs.get("Name for Speaker 1").value).toBe("");
  m.handlers.get("Cancel")!();
  render(props);
  expect(base.onSave).not.toHaveBeenCalled();
});
it("does not offer to identify an unlabeled legacy transcript", () => {
  expect(render({ ...base, transcript: "A plain transcript" })).toBe("");
  expect(m.handlers.size).toBe(0);
});
