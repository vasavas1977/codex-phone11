import "dotenv/config";
import { parseArgs } from "node:util";
import { getPool } from "../server/pbx/db";
import {
  applyAndroidStagingSeed,
  inspectAndroidStagingSeed,
  readAndroidStagingSeedConfig,
} from "../server/_core/phone11-android-staging-seed";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    "confirm-empty-database": { type: "boolean", default: false },
    project: { type: "string" },
    instance: { type: "string" },
    database: { type: "string" },
    extension: { type: "string" },
    domain: { type: "string" },
    email: { type: "string" },
  },
});

async function main() {
  const database = getPool();
  try {
    const config = readAndroidStagingSeedConfig({
      apply: values.apply,
      confirmEmptyDatabase: values["confirm-empty-database"],
      project: values.project,
      instance: values.instance,
      database: values.database,
      extension: values.extension,
      domain: values.domain,
      email: values.email,
    });
    if (config.apply) {
      const result = await applyAndroidStagingSeed(database, config);
      console.info(
        JSON.stringify({
          event: "phone11.android.staging.seed.applied",
          ...result,
        }),
      );
    } else {
      const plan = await inspectAndroidStagingSeed(database);
      console.info(
        JSON.stringify({ event: "phone11.android.staging.seed.plan", ...plan }),
      );
      console.info(
        "Plan only. Re-run with --apply --confirm-empty-database after review.",
      );
    }
  } catch {
    console.error(
      "Android staging seed failed closed. Check the exact isolated target, empty schema and operator inputs. No credentials were logged.",
    );
    process.exitCode = 1;
  } finally {
    await database.end();
  }
}

void main();
