import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const moduleRoot = path.join(process.cwd(), "node_modules", "react-native-pjsip", "android");
const gradlePath = path.join(moduleRoot, "build.gradle");
const manifestPath = path.join(moduleRoot, "src", "main", "AndroidManifest.xml");
const fallbackNamespace = "com.carusto.ReactNativePjSip";

async function readIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function patchFile(filePath, patcher) {
  const source = await readIfExists(filePath);
  if (source === null) {
    console.warn(`[phone11-pjsip-patch] Skipping missing file: ${filePath}`);
    return false;
  }

  const next = patcher(source);
  if (next === source) {
    return false;
  }

  await writeFile(filePath, next);
  return true;
}

const manifestSource = await readIfExists(manifestPath);
const manifestPackage = manifestSource?.match(/<manifest\b[^>]*\s+package=["']([^"']+)["']/)?.[1];
const namespace = manifestPackage || fallbackNamespace;
const escapedNamespace = namespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const gradleChanged = await patchFile(gradlePath, (source) => {
  let next = source
    .replace(/\bcompile\s+(["'])com\.facebook\.react:react-native:\+\1/g, 'implementation "com.facebook.react:react-android"')
    .replace(/\bcompile\s+project\(/g, "implementation project(")
    .replace(/\bcompile\s+fileTree\(/g, "implementation fileTree(")
    .replace(/\bcompile\s+/g, "implementation ");

  if (/android\s*\{/.test(next) && !new RegExp(`\\bnamespace\\s+["']${escapedNamespace}["']`).test(next)) {
    next = next.replace(/android\s*\{\s*/, (match) => `${match}\n    namespace "${namespace}"\n`);
  }

  return next;
});

const manifestChanged = await patchFile(manifestPath, (source) =>
  source.replace(/(<manifest\b[^>]*?)\s+package=["'][^"']+["']([^>]*>)/, "$1$2")
);

if (gradleChanged || manifestChanged) {
  console.log("[phone11-pjsip-patch] Patched react-native-pjsip Android Gradle config.");
} else {
  console.log("[phone11-pjsip-patch] react-native-pjsip Android Gradle config already patched.");
}
