import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { auditHandlerImports, inventoryHandlerImports, type GraphPins } from "../scripts/phone11-pbx-clone/audit-handler-imports";

const roots: string[] = [];
function fixture(source = 'import { value } from "./value"; export const appRouter = { value };') {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "phone11-import-audit-")); roots.push(root);
  mkdirSync(path.join(root, "server"));
  writeFileSync(path.join(root, "package.json"), "{}");
  writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(path.join(root, "tsconfig.json"), "{}");
  writeFileSync(path.join(root, "server/routers.ts"), source);
  writeFileSync(path.join(root, "server/value.ts"), "export const value = 1;");
  return root;
}
function pins(root: string) { return inventoryHandlerImports({ root }).pins; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("offline real-handler import preparation", () => {
  it("matches separately frozen bytes deterministically without runtime admission", () => {
    const root = fixture(), expected = pins(root);
    expect(inventoryHandlerImports({ root })).toEqual(inventoryHandlerImports({ root }));
    expect(auditHandlerImports({ root }, expected)).toMatchObject({ inventoryMatched: true, runtimeAdmission: false, externalCodeInspected: false });
  });
  it("never executes hostile source while inventorying it", () => {
    const root = fixture('throw new Error("MUST_NOT_EXECUTE"); import "./value";');
    expect(inventoryHandlerImports({ root }).findings).toContainEqual(expect.objectContaining({ kind: "MODULE_STATEMENT_REVIEW_REQUIRED", phase: "module" }));
  });
  it("refuses a new unknown external import against the frozen graph", () => {
    const root = fixture(), expected = pins(root);
    writeFileSync(path.join(root, "server/routers.ts"), 'import "unknown-provider";');
    expect(() => auditHandlerImports({ root }, expected)).toThrow("GRAPH_PIN_MISMATCH");
  });
  it("pins newly reachable sources and refuses source or lock drift", () => {
    const root = fixture(), expected = pins(root);
    writeFileSync(path.join(root, "server/value.ts"), "export const value = 2;");
    expect(() => auditHandlerImports({ root }, expected)).toThrow("GRAPH_PIN_MISMATCH");
    writeFileSync(path.join(root, "server/value.ts"), "export const value = 1;");
    writeFileSync(path.join(root, "pnpm-lock.yaml"), "changed");
    expect(() => auditHandlerImports({ root }, expected)).toThrow("GRAPH_PIN_MISMATCH");
  });
  it.each(["leaf", "ancestor", "input", "root"])("refuses %s symlink custody", (kind) => {
    const root = fixture();
    if (kind === "leaf") { rmSync(path.join(root, "server/value.ts")); symlinkSync("routers.ts", path.join(root, "server/value.ts")); }
    if (kind === "ancestor") { rmSync(path.join(root, "server"), { recursive: true }); mkdirSync(path.join(root, "other")); symlinkSync("other", path.join(root, "server")); }
    if (kind === "input") { rmSync(path.join(root, "package.json")); symlinkSync("tsconfig.json", path.join(root, "package.json")); }
    if (kind === "root") { symlinkSync(root, root + "-alias"); roots.push(root + "-alias"); }
    expect(() => inventoryHandlerImports({ root: kind === "root" ? root + "-alias" : root })).toThrow(/CUSTODY/);
  });
  it("refuses ambiguous extension resolution", () => {
    const root = fixture(); writeFileSync(path.join(root, "server/value.js"), "export const value = 1;");
    expect(() => inventoryHandlerImports({ root })).toThrow("AMBIGUOUS_IMPORT");
  });
  it.each(['import(name)', 'require(name)', 'import "../../outside"', 'import "./absent"', 'import "https://provider.invalid/module"'])("refuses unresolved or computed imports: %s", source => {
    const root = fixture(source);
    expect(() => inventoryHandlerImports({ root })).toThrow(/COMPUTED_IMPORT|IMPORT_ESCAPE|UNRESOLVED_IMPORT|EXTERNAL_SPECIFIER/);
  });
  it("follows literal lazy imports, export-from, aliases and cycles", () => {
    const root = fixture('export * from "@/server/value"; export async function lazy() { return import("./lazy.js"); }');
    writeFileSync(path.join(root, "server/lazy.ts"), 'import "./routers"; export const value = 1;');
    const result = inventoryHandlerImports({ root });
    expect(Object.keys(result.pins.sources)).toEqual(["server/lazy.ts", "server/routers.ts", "server/value.ts"]);
    expect(result.edges).toContainEqual({ from: "server/routers.ts", to: "server/lazy.ts", mode: "lazy", kind: "source" });
  });
  it("excludes exclusively type-only dependencies and retains mixed imports", () => {
    const root = fixture('import type { A } from "./absent"; import { type B } from "./also-absent"; export type { C } from "./third-absent"; import { type T, value } from "./value";');
    expect(inventoryHandlerImports({ root }).edges).toHaveLength(1);
  });
  it("detects eager env/startup and deferred connection/provider/resource seams", () => {
    const root = fixture('import pg from "pg"; const initial = process.env.UNREAD_VALUE; const pool = new pg.Pool({}); const server = start(); server.listen(1); export function lazy() { fetch("UNREAD_URL"); return getPool().query("UNREAD_SQL"); }');
    const result = inventoryHandlerImports({ root });
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "AMBIENT_ENV_BLOCKED", phase: "module" }));
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "DB_OR_CONNECTION_BOUNDARY", symbol: "pg.Pool", phase: "module" }));
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "RESOURCE_OR_LOADER_BOUNDARY", symbol: "server.listen", phase: "module" }));
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "RESOURCE_OR_LOADER_BOUNDARY", symbol: "fetch", phase: "deferred" }));
    expect(JSON.stringify(result)).not.toMatch(/UNREAD_VALUE|UNREAD_URL|UNREAD_SQL/);
  });
  it("marks opaque aliased loaders blocked even without a visible require()", () => {
    const root = fixture('import { createRequire as loader } from "node:module"; const r = loader(import.meta.url); r("private-provider");');
    const result = inventoryHandlerImports({ root });
    expect(result.runtimeAdmission).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "EXTERNAL_CODE_UNREVIEWED", symbol: "node:module" }));
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "MODULE_INITIALIZATION_REVIEW_REQUIRED", symbol: "loader" }));
  });
  it("pins literal asset resolution and refuses computed asset resolution", () => {
    const root = fixture('import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const asset = require.resolve("@jsquash/jpeg/decode.js");');
    const result = inventoryHandlerImports({ root });
    expect(result.edges).toContainEqual({ from: "server/routers.ts", to: "@jsquash/jpeg/decode.js", kind: "external", mode: "resolve" });
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "OPAQUE_LOADER_BLOCKED", symbol: "require.resolve" }));
    writeFileSync(path.join(root, "server/routers.ts"), 'const asset = require.resolve(variable);');
    expect(() => inventoryHandlerImports({ root })).toThrow("COMPUTED_IMPORT");
  });
  it.each([{ files: 1 }, { fileBytes: 10 }, { totalBytes: 10 }, { edges: 1 }, { findings: 1 }])("enforces finite bounds %j", limits => {
    const root = fixture('import "./value"; import "pg"; const p = new Pool({});');
    expect(() => inventoryHandlerImports({ root, limits })).toThrow(/GRAPH_|SOURCE_SIZE/);
  });
  it("refuses expanded bounds, malformed syntax, compiler/hash/key/external pins", () => {
    const root = fixture(), expected = pins(root);
    expect(() => inventoryHandlerImports({ root, limits: { files: 257 } })).toThrow("LIMIT_VALUE");
    for (const malformed of [
      { ...expected, extra: true },
      { ...expected, compiler: { ...expected.compiler, sha256: "bad" } },
      { ...expected, sources: { "../escape.ts": "a".repeat(64) } },
      { ...expected, externals: ["pg", "pg"] },
      { ...expected, inputs: {} },
    ]) expect(() => auditHandlerImports({ root }, malformed as GraphPins)).toThrow();
    writeFileSync(path.join(root, "server/routers.ts"), "export const =;");
    expect(() => inventoryHandlerImports({ root })).toThrow("SOURCE_SYNTAX");
  });
  it("records the actual entire appRouter graph as blocked preparation, never executes it", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const result = inventoryHandlerImports({ root });
    expect(result.pins.entry).toBe("server/routers.ts");
    expect(result.pins.sources["server/routers.ts"]).toBe("8eaa96aae06b384e4cdf06375ba8df50f7bf6281d549d3c5d0ac667b48b68e30");
    expect(result.pins.sources["server/pbx/db.ts"]).toBe("73c37d847f23b5a6d33507c62dc666dbc8e601a09f306ba539d1de333b5b3709");
    expect(result.pins.externals).toContain("google-auth-library");
    expect(result.pins.externals).toContain("@jsquash/jpeg/decode.js");
    expect(result.findings).toContainEqual(expect.objectContaining({ file: "server/_core/env.ts", kind: "AMBIENT_ENV_BLOCKED", phase: "module" }));
    expect(result.findings).toContainEqual(expect.objectContaining({ file: "server/push/apns.ts", kind: "MODULE_INITIALIZATION_REVIEW_REQUIRED", symbol: "createApnsSender" }));
    expect(result.runtimeAdmission).toBe(false);
    expect(auditHandlerImports({ root }, result.pins).inventoryMatched).toBe(true);
  });
});
