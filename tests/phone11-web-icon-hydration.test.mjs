import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const run = promisify(execFile);
const candidates = [
  process.env.PHONE11_HYDRATION_BROWSER,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
let browser;
for (const candidate of candidates) {
  try {
    await access(candidate);
    browser = candidate;
    break;
  } catch {
    // Browser discovery reads paths only; never install or reuse a browser profile.
  }
}

const app = `
import React, { Suspense } from "react";
import { IconSymbol } from ${JSON.stringify(path.join(root, "components/ui/icon-symbol.tsx"))};
function App({ extra = false }) {
  return <main>
    <Suspense fallback={null}><section hidden><button aria-label="Call number"><IconSymbol name="phone.fill" size={28} color="#fff" /></button></section></Suspense>
    <Suspense fallback={null}><button aria-label="Open admin navigation"><IconSymbol name="list.bullet" size={24} color="#0D0F14" /></button></Suspense>
    {extra && <button aria-label="Later icon"><IconSymbol name="checkmark" size={18} color="#0057FF" /></button>}
  </main>;
}`;
const options = {
  absWorkingDir: root,
  bundle: true,
  write: false,
  loader: { ".js": "jsx", ".ttf": "dataurl", ".png": "dataurl" },
  resolveExtensions: [".web.tsx", ".tsx", ".web.ts", ".ts", ".web.jsx", ".jsx", ".web.js", ".js", ".json"],
  alias: { "react-native": "react-native-web", "@": root },
  define: {
    __DEV__: "true",
    "process.env.NODE_ENV": '"development"',
    "process.env.EXPO_OS": '"web"',
  },
  jsx: "automatic",
  logLevel: "silent",
};

for (const warmFontCache of [false, true]) {
  test(`real DOM hydration preserves icon markup with ${warmFontCache ? "warm" : "cold"} font cache`, {
    skip: !browser && "Set PHONE11_HYDRATION_BROWSER to an existing Chromium executable; no browser is installed by this test.",
    timeout: 30_000,
  }, async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "phone11-icon-hydration-"));
    try {
      const server = await build({
        ...options,
        stdin: { contents: `${app}\nimport { renderToString } from "react-dom/server";exports.html = renderToString(<App />);`, sourcefile: "server.tsx", resolveDir: root, loader: "tsx" },
        platform: "node",
        format: "cjs",
      });
      const serverPath = path.join(temporary, "server.cjs");
      await writeFile(serverPath, server.outputFiles[0].contents);
      const { html } = require(serverPath);
      const client = await build({
        ...options,
        stdin: {
          contents: `${app}
import { hydrateRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as Font from "expo-font";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
(async () => {
  ${warmFontCache ? "await Font.loadAsync(MaterialIcons.font);" : ""}
  const failures = [];
  const root = hydrateRoot(document.getElementById("root"), <App />, { onRecoverableError: error => failures.push(error.message) });
  setTimeout(() => {
    const initialGlyphs = Array.from(document.querySelectorAll("button")).map(button => button.textContent);
    flushSync(() => root.render(<App extra />));
    document.getElementById("result").textContent = JSON.stringify({
      failures, initialGlyphs, fontLoaded: Font.isLoaded("material"),
      laterGlyph: document.querySelector('[aria-label="Later icon"]').textContent,
      iconStyle: document.querySelector('[aria-label="Open admin navigation"] > div').getAttribute("style"),
    });
  }, 200);
})().catch(error => { document.getElementById("result").textContent = JSON.stringify({ exception: error.message }); });`,
          sourcefile: "client.tsx", resolveDir: root, loader: "tsx",
        },
        platform: "browser",
        format: "iife",
      });
      const documentPath = path.join(temporary, "hydration.html");
      // Everything is inline, including the actual font. CSP and denied DNS prevent API/network effects.
      await writeFile(documentPath, `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; img-src data:"></head><body><div id="root">${html}</div><pre id="result">PENDING</pre><script>${client.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`);
      const { stdout } = await run(browser, [
        "--headless", "--disable-gpu", "--no-sandbox", "--disable-background-networking",
        "--host-resolver-rules=MAP * ~NOTFOUND", `--user-data-dir=${path.join(temporary, "profile")}`,
        "--dump-dom", "--virtual-time-budget=2000", pathToFileURL(documentPath).href,
      ], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
      const match = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
      assert.ok(match, "isolated browser must report hydration result");
      const result = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
      assert.equal(result.exception, undefined);
      assert.deepEqual(result.failures, [], "actual hydrateRoot must not recover from a server/client mismatch");
      assert.equal(result.fontLoaded, true);
      assert.deepEqual(result.initialGlyphs, ["\ue0cd", "\ue896"]);
      assert.equal(result.laterGlyph, "\ue5ca", "icons mounted after hydration render immediately");
      assert.match(result.iconStyle, /font-family: material/);
      assert.match(result.iconStyle, /font-size: 24px/);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
