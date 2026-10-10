#!/usr/bin/env node
/** Unsigned offline build. Never installs, starts or activates the bundled programs. */
import { build, version } from "esbuild";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBuiltin } from "node:module";
import ts from "typescript";
import { reviewedHelpers } from "./phone11-voicemail-helper-preflight";
import { artifactModes, bundleSchema, canonicalJson, readArtifact, requireContract, runtimePaths,
  sha256, sourceFiles, type ArtifactName, type BundleManifest } from "./phone11-voicemail-bundle-contract";

function builtin(specifier: string): boolean {
  return specifier.startsWith("node:") && isBuiltin(specifier);
}
/** esbuild cannot resolve a computed import/require; refuse it before compiling captured bytes. */
function checkDependencySyntax(contents: string, file: string): void {
  const source = ts.createSourceFile(file, contents, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const check = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
      requireContract(ts.isStringLiteral(node.moduleSpecifier) && builtin(node.moduleSpecifier.text), "Non-builtin dependency refused");
    requireContract(!ts.isImportEqualsDeclaration(node) && !ts.isImportTypeNode(node), "Unsupported dependency syntax");
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      requireContract(expression.kind !== ts.SyntaxKind.ImportKeyword &&
        !(ts.isIdentifier(expression) && expression.text === "require") &&
        !(ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "require"),
      "Dynamic/CommonJS dependency refused");
    }
    ts.forEachChild(node, check);
  };
  check(source);
}

export async function buildVoicemailBundle(sourceRoot: string, destination: string, sourceRevision: string) {
  requireContract(/^[a-f0-9]{40}$/.test(sourceRevision), "Exact source revision required");
  requireContract(process.versions.node.split(".")[0] === "22", "Node 22 build runtime required");
  requireContract(path.isAbsolute(sourceRoot) && path.isAbsolute(destination), "Absolute build paths required");
  requireContract(sourceRoot === path.resolve(sourceRoot) && destination === path.resolve(destination), "Build paths must be normalized");
  requireContract(await realpath(sourceRoot) === path.resolve(sourceRoot), "Source root must be resolved");
  requireContract(await realpath(path.dirname(destination)) === path.dirname(path.resolve(destination)), "Bundle parent must be resolved");
  requireContract(!(destination === sourceRoot || destination.startsWith(sourceRoot + path.sep)), "Build outside source checkout");
  const uid = process.getuid!();
  const inputs: Record<string, string> = {};
  const bytes = new Map<string, Buffer>();
  for (const file of sourceFiles) {
    requireContract(await realpath(path.join(sourceRoot, file)) === path.join(sourceRoot, file), "Source input must be resolved");
    const value = await readArtifact(path.join(sourceRoot, file), uid);
    bytes.set(file, value);
    inputs[file] = sha256(value);
  }
  // Stage both exact reviewed copies; divergence cannot silently pick a helper.
  for (const [name, expected] of Object.entries(reviewedHelpers)) {
    requireContract(inputs[`deploy/freeswitch/scripts/${name}`] === expected &&
      inputs[`infra/configs/freeswitch/scripts/${name}`] === expected, "Reviewed helper input mismatch");
  }
  const artifacts = {} as Record<ArtifactName, Buffer>;
  for (const name of ["producer", "relay"] as const) {
    const file = `scripts/phone11-voicemail-${name}.ts`;
    const contents = bytes.get(file)!.toString("utf8");
    checkDependencySyntax(contents, file);
    const result = await build({
      stdin: { contents, sourcefile: file, loader: "ts" },
      absWorkingDir: sourceRoot, bundle: true, platform: "node", format: "esm", target: "node22",
      write: false, sourcemap: false, legalComments: "none", charset: "utf8", metafile: true, logLevel: "silent",
      plugins: [{ name: "captured-inputs-only", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => builtin(args.path)
          ? { path: args.path, external: true }
          : { errors: [{ text: "Non-builtin dependency refused" }] });
        builder.onLoad({ filter: /.*/ }, () => ({ errors: [{ text: "Uncaptured filesystem input refused" }] }));
      } }],
    });
    requireContract(result.outputFiles?.length === 1 && Object.values(result.metafile!.outputs).every(output =>
      output.imports.every(item => item.external && item.path.startsWith("node:"))), "Unexpected bundle dependency");
    artifacts[`${name}.mjs`] = Buffer.from(result.outputFiles[0].contents);
  }
  artifacts["runner.sh"] = bytes.get("scripts/phone11-voicemail-runner.sh")!;
  artifacts["phone11_legacy_voicemail.lua"] = bytes.get("infra/configs/freeswitch/scripts/phone11_legacy_voicemail.lua")!;
  artifacts["phone11_voicemail_deposit.lua"] = bytes.get("infra/configs/freeswitch/scripts/phone11_voicemail_deposit.lua")!;
  const manifest: BundleManifest = {
    schema: bundleSchema, sourceRevision, builder: { esbuildVersion: version, typescriptVersion: ts.version, nodeTarget: "node22" }, runtimePaths, inputs,
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, value]) =>
      [name, { sha256: sha256(value), size: value.length, mode: artifactModes[name as ArtifactName] }])) as BundleManifest["artifacts"],
  };
  // A fresh directory only: never overwrite an existing candidate or recovery bundle.
  await mkdir(destination, { mode: 0o700 });
  for (const [name, value] of Object.entries(artifacts))
    await writeFile(path.join(destination, name), value, { flag: "wx", mode: parseInt(artifactModes[name as ArtifactName], 8) });
  const raw = canonicalJson(manifest);
  await writeFile(path.join(destination, "manifest.json"), raw, { flag: "wx", mode: 0o600 });
  return { manifestSha256: sha256(raw), sourceRevision, unsigned: true, commissioningApproved: false, rolloutApproved: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const fields = ["--source-root", "--output", "--source-revision"];
  if (args.length !== 6 || fields.some((flag, index) => args[index * 2] !== flag)) {
    process.stderr.write("Usage: phone11-voicemail-bundle --source-root ABS --output NEW_ABS --source-revision SHA40\n");
    process.exitCode = 1;
  } else {
    buildVoicemailBundle(args[1], args[3], args[5]).then(result => {
      process.stdout.write(canonicalJson(result));
    }).catch(() => {
      // Do not echo input paths, environment values or compiler source diagnostics.
      process.stderr.write("Voicemail offline build refused; candidate directory may contain incomplete artifacts\n");
      process.exitCode = 1;
    });
  }
}
