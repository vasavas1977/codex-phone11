import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const moduleRoot = path.join(process.cwd(), "node_modules", "react-native-pjsip", "android");
const gradlePath = path.join(moduleRoot, "build.gradle");
const manifestPath = path.join(moduleRoot, "src", "main", "AndroidManifest.xml");
const sourceRoot = path.join(moduleRoot, "src", "main", "java");
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

async function patchSourceTree(rootPath) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.warn(`[phone11-pjsip-patch] Skipping missing source tree: ${rootPath}`);
      return false;
    }
    throw error;
  }

  let changed = false;
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      changed = (await patchSourceTree(entryPath)) || changed;
      continue;
    }

    if (!/\.(java|kt)$/.test(entry.name)) {
      continue;
    }

    changed =
      (await patchFile(entryPath, (source) =>
        source.replace(/\bandroid\.support\.annotation\./g, "androidx.annotation.")
      )) || changed;
  }

  return changed;
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
    .replace(/\bcompile\s+/g, "implementation ")
    .replace(/\bcompileSdkVersion\s+\d+/g, "compileSdkVersion rootProject.ext.compileSdkVersion")
    .replace(/\btargetSdkVersion\s+\d+/g, "targetSdkVersion rootProject.ext.targetSdkVersion")
    .replace(/\bcompileSdk\s+\d+/g, "compileSdk rootProject.ext.compileSdkVersion")
    .replace(/\btargetSdk\s+\d+/g, "targetSdk rootProject.ext.targetSdkVersion")
    .replace(/\n\s*implementation\s+["']androidx\.annotation:annotation:[^"']+["']\s*/g, "\n");

  if (/android\s*\{/.test(next) && !new RegExp(`\bnamespace\s+["']${escapedNamespace}["']`).test(next)) {
    next = next.replace(/android\s*\{\s*/, (match) => `${match}\n    namespace "${namespace}"\n`);
  }

  if (!/androidx\.annotation:annotation/.test(next)) {
    const dependencyBlockMatches = [...next.matchAll(/dependencies\s*\{/g)];
    const projectDependencyBlock =
      dependencyBlockMatches.length > 1
        ? dependencyBlockMatches[dependencyBlockMatches.length - 1]
        : null;

    if (projectDependencyBlock?.index !== undefined) {
      const insertAt = projectDependencyBlock.index + projectDependencyBlock[0].length;
      next =
        next.slice(0, insertAt) +
        '\n    implementation "androidx.annotation:annotation:1.9.1"' +
        next.slice(insertAt);
    } else {
      next += '\n\ndependencies {\n    implementation "androidx.annotation:annotation:1.9.1"\n}\n';
    }
  }

  return next;
});

const manifestChanged = await patchFile(manifestPath, (source) =>
  source.replace(/(<manifest\b[^>]*?)\s+package=["'][^"']+["']([^>]*>)/, "$1$2")
);
const sourceChanged = await patchSourceTree(sourceRoot);

if (gradleChanged || manifestChanged || sourceChanged) {
  console.log("[phone11-pjsip-patch] Patched react-native-pjsip Android Gradle/source config.");
} else {
  console.log("[phone11-pjsip-patch] react-native-pjsip Android Gradle/source config already patched.");
}
