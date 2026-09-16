import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server");
const state = vi.hoisted(() => ({ user: { id: 1 } as { id: number } | null, result: {} as any }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "blue" }) }));
vi.mock("../lib/trpc", () => ({ trpc: { meetings: { capabilities: { useQuery: () => state.result } } } }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("react-native", () => ({ Pressable: ({ children }: any) => createElement("button", null, children), Text: ({ children }: any) => children }));
import { MeetAction } from "../components/meet-action";
it.each([{ isLoading: true }, { error: new Error() }, { data: { available: false } }, { isFetching: true, data: { available: true } }])("hides Meet until availability is confirmed: %j", result => {
 state.user = { id: 1 }; state.result = result; expect(renderToStaticMarkup(<MeetAction />)).toBe("");
});
it("shows a separate Meet action only for an authenticated available service", () => {
 state.result = { data: { available: true } }; state.user = { id: 1 };
 expect(renderToStaticMarkup(<MeetAction />)).toContain("Meet");
 state.user = null; expect(renderToStaticMarkup(<MeetAction />)).toBe("");
});
