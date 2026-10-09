/** Offline source inventory only. This module never imports the product graph.
 * A matching inventory is not permission to load appRouter: every resource,
 * external dependency and initialization boundary still requires review.
 */
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

export class ImportAuditRefused extends Error {
  constructor(readonly code: string) { super(code); }
}
const refuse = (code: string): never => { throw new ImportAuditRefused(code); };
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const hashPattern = /^[a-f0-9]{64}$/;
const sourcePath = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs|cjs)$/;
const externalPattern = /^(?:node:[a-z0-9_]+(?:\/[a-z0-9_]+)*|(?:@[a-z0-9_-]+\/)?[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*)$/;
export const AUDIT_LIMITS = Object.freeze({ files: 256, fileBytes: 1_048_576, totalBytes: 16_777_216, edges: 4096, findings: 16384 });
const inputPaths = ["package.json", "pnpm-lock.yaml", "tsconfig.json"] as const;
interface Limits { files: number; fileBytes: number; totalBytes: number; edges: number; findings: number }
export interface Edge { from: string; to: string; kind: "source" | "external"; mode: "static" | "lazy" | "resolve" }
export interface Finding { file: string; line: number; kind: string; phase: "module" | "deferred"; symbol: string }
export interface GraphPins {
  schema: "phone11-handler-import-pins/v1";
  entry: string;
  compiler: { version: string; sha256: string };
  inputs: Record<string, string>;
  sources: Record<string, string>;
  externals: string[];
  edgesHash: string;
  findingsHash: string;
}
export interface ImportInventory {
  schema: "phone11-handler-import-inventory/v1";
  pins: GraphPins;
  edges: Edge[];
  findings: Finding[];
  sourceBytes: number;
  graphSemantics: "CONSERVATIVE_NON_TYPE_IMPORTS_INCLUDING_LAZY";
  runtimeAdmission: false;
  externalCodeInspected: false;
  permittedFutureDbAlias: "server/pbx/db.ts";
}
export interface InventoryOptions { root: string; entry?: string; limits?: Partial<Limits> }

function protectedRoot(root: string): string {
  const absolute = path.resolve(root);
  for (let p = absolute;; p = path.dirname(p)) {
    const stat = lstatSync(p);
    if (stat.isSymbolicLink() || !stat.isDirectory()) refuse("ROOT_CUSTODY");
    if (p === path.dirname(p)) break;
  }
  if (realpathSync(absolute) !== absolute) refuse("ROOT_ALIAS");
  return absolute;
}

/** Reject source links before opening; nonblocking refuses FIFOs without hanging. */
function sourceBytes(root: string, relative: string, maximum: number): Buffer {
  if (!relative || relative.startsWith("/") || relative.split("/").some(v => !v || v === "." || v === "..")) refuse("SOURCE_PATH");
  const parts = relative.split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch { return refuse("SOURCE_MISSING"); }
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) refuse("SOURCE_CUSTODY");
  }
  let fd;
  try { fd = openSync(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch { return refuse("SOURCE_OPEN"); }
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum) refuse("SOURCE_SIZE_OR_CUSTODY");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) refuse("SOURCE_CHANGED");
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset)) refuse("SOURCE_CHANGED");
    const after = fstatSync(fd), leaf = lstatSync(current);
    if (bytes.length > maximum || !leaf.isFile() || leaf.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || leaf.dev !== before.dev || leaf.ino !== before.ino) refuse("SOURCE_CHANGED");
    return bytes;
  } finally { closeSync(fd); }
}

function compilerPin(): GraphPins["compiler"] {
  const require = createRequire(import.meta.url);
  const compiler = realpathSync(require.resolve("typescript"));
  const bytes = readFileSync(compiler);
  if (ts.version !== "5.9.3" || bytes.length > 16_777_216) refuse("COMPILER_VERSION_OR_SIZE");
  return { version: ts.version, sha256: digest(bytes) };
}

function limitsFor(overrides: Partial<Limits> = {}): Limits {
  if (Object.keys(overrides).some(k => !(k in AUDIT_LIMITS))) refuse("LIMIT_KEYS");
  const limits = { ...AUDIT_LIMITS, ...overrides };
  for (const key of Object.keys(AUDIT_LIMITS) as (keyof Limits)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > AUDIT_LIMITS[key]) refuse("LIMIT_VALUE");
  }
  return limits;
}

function callSymbol(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${callSymbol(node.expression)}.${node.name.text}`;
  if (ts.isElementAccessExpression(node)) return `${callSymbol(node.expression)}.[computed]`;
  return "[expression]";
}
function deferred(node: ts.Node): boolean {
  for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    // Initializer calls in class fields are conservative module boundaries.
    if (ts.isFunctionLike(parent)) return true;
  }
  return false;
}

export function inventoryHandlerImports(options: InventoryOptions): ImportInventory {
  const root = protectedRoot(options.root), limits = limitsFor(options.limits);
  const entry = options.entry ?? "server/routers.ts";
  if (!sourcePath.test(entry)) refuse("ENTRY_PATH");
  const compiler = compilerPin(), sources: Record<string, string> = {}, inputs: Record<string, string> = {};
  const edges: Edge[] = [], findings: Finding[] = [], external = new Set<string>();
  const queue = [entry]; let totalBytes = 0;
  for (const relative of inputPaths) inputs[relative] = digest(sourceBytes(root, relative, limits.fileBytes));
  function resolve(from: string, specifier: string): string {
    let base: string;
    if (specifier.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    else if (specifier.startsWith("@/")) base = specifier.slice(2);
    else if (specifier.startsWith("@shared/")) base = `shared/${specifier.slice(8)}`;
    else return refuse("UNSUPPORTED_ALIAS");
    if (base.startsWith("../") || base.startsWith("/") || base.includes("\\")) refuse("IMPORT_ESCAPE");
    const candidates = [...new Set(/\.(?:ts|tsx|js|mjs|cjs)$/.test(base)
      ? [base, ...(/\.js$/.test(base) ? [base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx"] : [])]
      : [base + ".ts", base + ".tsx", base + ".js", base + "/index.ts", base + "/index.tsx", base + "/index.js"])];
    const found = candidates.filter(relative => {
      try { lstatSync(path.join(root, relative)); return true; } catch { return false; }
    });
    if (found.length !== 1) refuse(found.length ? "AMBIGUOUS_IMPORT" : "UNRESOLVED_IMPORT");
    if (!sourcePath.test(found[0])) refuse("IMPORT_PATH");
    return found[0];
  }
  for (let offset = 0; offset < queue.length; offset++) {
    const file = queue[offset];
    if (Object.hasOwn(sources, file)) continue;
    if (Object.keys(sources).length >= limits.files) refuse("GRAPH_FILES");
    const bytes = sourceBytes(root, file, limits.fileBytes); totalBytes += bytes.length;
    if (totalBytes > limits.totalBytes) refuse("GRAPH_BYTES");
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes)) refuse("SOURCE_ENCODING");
    sources[file] = digest(bytes);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    if ((ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) refuse("SOURCE_SYNTAX");
    const finding = (node: ts.Node, kind: string, symbol: string) => {
      if (findings.length >= limits.findings) refuse("GRAPH_FINDINGS");
      findings.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind, phase: deferred(node) ? "deferred" : "module", symbol });
    };
    const addImport = (node: ts.Node, literal: ts.Node | undefined, mode: Edge["mode"]) => {
      if (!literal || !ts.isStringLiteral(literal)) return refuse("COMPUTED_IMPORT");
      const specifier = literal.text;
      if (specifier.includes("\\") || specifier.includes("\0")) refuse("IMPORT_SPECIFIER");
      let to: string, kind: Edge["kind"];
      if (specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("@shared/")) {
        to = resolve(file, specifier); kind = "source"; queue.push(to);
      } else {
        if (!externalPattern.test(specifier) || specifier.split("/").some(v => v === "." || v === "..")) refuse("EXTERNAL_SPECIFIER");
        to = specifier; kind = "external"; external.add(to);
        finding(node, "EXTERNAL_CODE_UNREVIEWED", to);
      }
      if (edges.length >= limits.edges) refuse("GRAPH_EDGES");
      edges.push({ from: file, to, kind, mode });
    };
    const walk = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const allTypes = clause?.isTypeOnly || (!!clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(v => v.isTypeOnly));
        if (!allTypes) addImport(node, node.moduleSpecifier, "static");
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
        const allTypes = node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(v => v.isTypeOnly);
        if (!allTypes) addImport(node, node.moduleSpecifier, "static");
      } else if (ts.isImportEqualsDeclaration(node)) {
        if (!node.isTypeOnly) {
          if (!ts.isExternalModuleReference(node.moduleReference)) return refuse("IMPORT_EQUALS");
          addImport(node, node.moduleReference.expression, "static");
        }
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const symbol = callSymbol(node.expression);
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) addImport(node, node.arguments[0], "lazy");
        else if (symbol === "require") addImport(node, node.arguments?.[0], "lazy");
        else if (symbol === "require.resolve") addImport(node, node.arguments?.[0], "resolve");
        if (!deferred(node)) finding(node, "MODULE_INITIALIZATION_REVIEW_REQUIRED", symbol);
        if (/(?:^|\.)(?:getPool|Pool|createPool|createClient|drizzle|connect|query|withTransaction|getDb|database|betterAuth)(?:$|\.)/i.test(symbol)) finding(node, file === "server/pbx/db.ts" ? "DECLARED_DB_SEAM" : "DB_OR_CONNECTION_BOUNDARY", symbol);
        if (/(?:fetch|request|createConnection|createServer|listen|createRequire|require|eval|Function|Worker|spawn|exec|setInterval|setTimeout|Redis|GoogleAuth|createApns|readFile|writeFile|open|unlink|mkdir|realpath|stat)/i.test(symbol)) finding(node, "RESOURCE_OR_LOADER_BOUNDARY", symbol);
        if (/(?:createRequire|require\.resolve|eval|Function)/.test(symbol)) finding(node, "OPAQUE_LOADER_BLOCKED", symbol);
      }
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && callSymbol(node).startsWith("process.env")) finding(node, "AMBIENT_ENV_BLOCKED", "process.env");
      if (ts.isClassStaticBlockDeclaration(node)) finding(node, "MODULE_INITIALIZATION_REVIEW_REQUIRED", "class.static");
      if (!deferred(node) && ((ts.isExpressionStatement(node) && !ts.isStringLiteral(node.expression)) || ts.isThrowStatement(node) || ts.isIfStatement(node) || ts.isTryStatement(node) || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isSwitchStatement(node) || ts.isWithStatement(node))) finding(node, "MODULE_STATEMENT_REVIEW_REQUIRED", "statement");
      ts.forEachChild(node, walk);
    };
    walk(ast);
  }
  edges.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  findings.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const sortedSources = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => compare(a, b)));
  // The graph is never admitted from a partially changing source tree.
  for (const [file, hash] of Object.entries({ ...inputs, ...sortedSources })) if (digest(sourceBytes(root, file, limits.fileBytes)) !== hash) refuse("SOURCE_DRIFT");
  if (JSON.stringify(compilerPin()) !== JSON.stringify(compiler)) refuse("COMPILER_DRIFT");
  return {
    schema: "phone11-handler-import-inventory/v1",
    pins: { schema: "phone11-handler-import-pins/v1", entry, compiler, inputs, sources: sortedSources, externals: [...external].sort(compare), edgesHash: digest(JSON.stringify(edges)), findingsHash: digest(JSON.stringify(findings)) },
    edges, findings, sourceBytes: totalBytes, graphSemantics: "CONSERVATIVE_NON_TYPE_IMPORTS_INCLUDING_LAZY", runtimeAdmission: false,
    externalCodeInspected: false, permittedFutureDbAlias: "server/pbx/db.ts",
  };
}

/** Verify a separately frozen inventory; an exact match proves static bytes only. */
export function auditHandlerImports(options: InventoryOptions, expected: GraphPins): ImportInventory & { inventoryMatched: true } {
  if (!expected || expected.schema !== "phone11-handler-import-pins/v1" || !sourcePath.test(expected.entry)) refuse("PIN_SCHEMA");
  if (Object.keys(expected).sort().join(",") !== "compiler,edgesHash,entry,externals,findingsHash,inputs,schema,sources") refuse("PIN_KEYS");
  if (Object.keys(expected.compiler).sort().join(",") !== "sha256,version" || expected.compiler.version !== "5.9.3" || !hashPattern.test(expected.compiler.sha256)) refuse("COMPILER_PIN");
  if (Object.keys(expected.inputs).sort().join(",") !== [...inputPaths].sort().join(",")) refuse("INPUT_PINS");
  if (!Object.hasOwn(expected.sources, expected.entry) || Object.keys(expected.sources).length > AUDIT_LIMITS.files) refuse("SOURCE_PINS");
  for (const [file, hash] of Object.entries(expected.sources)) if (!sourcePath.test(file) || !hashPattern.test(hash)) refuse("SOURCE_PINS");
  for (const hash of [...Object.values(expected.inputs), expected.edgesHash, expected.findingsHash]) if (!hashPattern.test(hash)) refuse("HASH_PIN");
  if (!Array.isArray(expected.externals) || expected.externals.length > AUDIT_LIMITS.edges || expected.externals.some(v => typeof v !== "string" || !externalPattern.test(v)) || JSON.stringify([...new Set(expected.externals)].sort(compare)) !== JSON.stringify(expected.externals)) refuse("EXTERNAL_PINS");
  const result = inventoryHandlerImports({ ...options, entry: expected.entry });
  // Compare semantic keys rather than relying on caller object insertion order.
  for (const key of ["entry", "compiler", "externals", "edgesHash", "findingsHash"] as const) if (JSON.stringify(result.pins[key]) !== JSON.stringify(expected[key])) refuse("GRAPH_PIN_MISMATCH");
  for (const key of ["inputs", "sources"] as const) {
    const sorted = Object.fromEntries(Object.entries(expected[key]).sort(([a], [b]) => compare(a, b)));
    if (JSON.stringify(result.pins[key]) !== JSON.stringify(sorted)) refuse("GRAPH_PIN_MISMATCH");
  }
  return { ...result, inventoryMatched: true };
}
