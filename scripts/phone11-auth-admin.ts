import "dotenv/config";
import { readFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { getPool } from "../server/pbx/db";
import { readAuthConfig } from "../server/_core/phone11-auth";
import { applyAuthMigration, createExistingUserIdentity, planAuthMigration, restoreEmptyCanonicalUser } from "../server/_core/phone11-auth-admin";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: "boolean", default: false },
    "user-id": { type: "string" },
    email: { type: "string" },
    "password-file": { type: "string" },
    "confirm-empty-users": { type: "boolean", default: false },
    extension: { type: "string" },
  },
});
const database = getPool();
try {
  const config = readAuthConfig();
  if (positionals[0] === "migrate") {
    if (values.apply) {
      const tables = await applyAuthMigration(database, config);
      console.info(JSON.stringify({ event: "phone11.auth.schema.applied", tables }));
    } else {
      const plan = await planAuthMigration(database, config);
      console.info(plan.sql);
      console.info("Plan only. No database changes made.");
    }
  } else if (positionals[0] === "restore-user") {
    if (!values.apply || !values["confirm-empty-users"] || !values["user-id"] || !values.email || !values.extension) {
      throw new Error("Requires --apply --confirm-empty-users --user-id --email --extension after owner approval");
    }
    const result = await restoreEmptyCanonicalUser(database, {
      userId: Number(values["user-id"]), email: values.email,
      extension: values.extension, confirmEmptyUsers: true,
    });
    console.info(JSON.stringify({ event: "phone11.auth.canonical-user.restored", userId: result.userId }));
  } else if (positionals[0] === "create-identity") {
    if (!values.apply || !values["user-id"] || !values.email || !values["password-file"]) {
      throw new Error("Requires --apply --user-id --email --password-file after owner approval");
    }
    const file = await stat(values["password-file"]);
    if (!file.isFile() || (file.mode & 0o077) !== 0 || file.uid !== process.getuid?.() || file.size > 512) {
      throw new Error("Password file must be a small owner-only file owned by the current user");
    }
    const password = (await readFile(values["password-file"], "utf8")).replace(/\r?\n$/, "");
    const result = await createExistingUserIdentity(database, {
      userId: Number(values["user-id"]), email: values.email, password,
    });
    console.info(JSON.stringify({ event: "phone11.auth.identity.created", userId: result.userId }));
  } else {
    throw new Error("Use migrate (plan only by default), migrate --apply, restore-user, or create-identity");
  }
} catch {
  // Database/validation errors can contain password values or hashes. Do not dump them.
  console.error("Phone11 auth administration failed. Check arguments, canonical identity, permissions and schema. No credentials were logged.");
  process.exitCode = 1;
} finally { await database.end(); }
