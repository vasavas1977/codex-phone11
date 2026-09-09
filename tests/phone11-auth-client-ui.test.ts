import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (node: ReactNode) => string;
};

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const container = ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    Platform: { OS: "ios" },
    StyleSheet: { create: (styles: unknown) => styles },
    View: container,
    SafeAreaView: container,
    ScrollView: container,
    KeyboardAvoidingView: container,
    Text: ({ children }: { children?: ReactNode }) =>
      createElement("span", null, children),
    Pressable: ({
      children,
      accessibilityLabel,
      disabled,
    }: {
      children?: ReactNode;
      accessibilityLabel?: string;
      disabled?: boolean;
    }) =>
      createElement(
        "button",
        { "aria-label": accessibilityLabel, disabled },
        children,
      ),
    TextInput: ({
      accessibilityLabel,
      secureTextEntry,
      value,
    }: {
      accessibilityLabel: string;
      secureTextEntry?: boolean;
      value?: string;
    }) =>
      createElement("input", {
        "aria-label": accessibilityLabel,
        type: secureTextEntry ? "password" : "text",
        defaultValue: value,
      }),
    ActivityIndicator: () => createElement("span", { role: "progressbar" }),
  };
});
vi.mock("react-native-safe-area-context", async () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
}));
vi.mock("@/components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("expo-router", () => ({
  router: { canGoBack: vi.fn(() => false), back: vi.fn(), replace: vi.fn() },
  Redirect: ({ href }: { href: string }) =>
    createElement("a", { href }, "Sign In"),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null, logout: vi.fn() }),
}));
vi.mock("@/lib/_core/api", () => ({
  authErrorMessage: () => "Try again",
  getMobileAuthConfig: vi.fn(),
  signInWithEmail: vi.fn(),
}));

const read = (path: string) =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8");

describe("Phone11 sign-in surface", () => {
  it("renders a direct email/password form with masked password and loading state", async () => {
    const { default: SignIn } = await import("../app/auth/sign-in");
    const html = renderToStaticMarkup(createElement(SignIn));
    expect(html).toContain("Phone11");
    expect(html).toContain('aria-label="Email"');
    expect(html).toContain('aria-label="Password" type="password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("Checking sign-in availability");
    expect(html).not.toMatch(/sign up|reset password|forgot password|manus/i);
  });

  it("renders legacy callback links only as navigation to Phone11 sign-in", async () => {
    const { default: Callback } = await import("../app/oauth/callback");
    expect(renderToStaticMarkup(createElement(Callback))).toBe(
      '<a href="/auth/sign-in">Sign In</a>',
    );
    const source = read("app/oauth/callback.tsx");
    expect(source).not.toMatch(
      /sessionToken|searchParams|useLocalSearchParams|setSessionToken|exchangeOAuthCode|Linking/,
    );
  });

  it("contains no external OAuth redirects, browser bearer persistence, or auth logging in the client", () => {
    for (const path of [
      "constants/oauth.ts",
      "lib/_core/api.ts",
      "lib/_core/auth.ts",
      "hooks/use-auth.ts",
      "app/auth/sign-in.tsx",
      "app/oauth/callback.tsx",
      "app/_layout.tsx",
    ]) {
      const source = read(path);
      expect(source, path).not.toMatch(
        /manus\.im|app-auth|initManusRuntime|postMessage|window\.location\.href|Linking\.openURL/,
      );
      expect(source, path).not.toMatch(
        /localStorage|AsyncStorage|console\.(log|warn|error|debug|info)/,
      );
    }
  });

  it("keeps Settings sign-in navigation local and owner-scopes explicitly synced SIP accounts", () => {
    for (const path of ["app/(tabs)/settings.tsx", "app/settings/sip.tsx"]) {
      const source = read(path);
      expect(source, path).toContain("router.push(SIGN_IN_ROUTE)");
      expect(source, path).not.toMatch(
        /startOAuthLogin|isOAuthConfigured|getLoginUrl/,
      );
    }
    const sipSource = read("app/settings/sip.tsx");
    expect(sipSource).toContain("getAuthSnapshot().user?.id !== user.id");
    expect(sipSource).toContain("ownerUserId: user.id");
  });

  it("parses and transpiles all touched auth screens and hooks", () => {
    for (const path of [
      "app/auth/sign-in.tsx",
      "app/oauth/callback.tsx",
      "app/_layout.tsx",
      "app/(tabs)/settings.tsx",
      "app/settings/sip.tsx",
      "hooks/use-auth.ts",
    ]) {
      const result = ts.transpileModule(read(path), {
        fileName: path,
        reportDiagnostics: true,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      });
      expect(
        result.diagnostics?.filter(
          (item) => item.category === ts.DiagnosticCategory.Error,
        ),
        path,
      ).toEqual([]);
    }
  });
});
