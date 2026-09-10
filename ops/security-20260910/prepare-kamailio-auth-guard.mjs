import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const approvedSourceSha256 = "6088a5bbef3007b7255e3ae599dee3d4dcf94e18b4affd88eb0624419613b5b7";
export const sha256 = value => createHash("sha256").update(value).digest("hex");

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error("Expected exactly one known routing block; refuse unknown configuration");
  return source.replace(before, after);
}

export function prepareAuthGuard(source) {
  if (sha256(source) !== approvedSourceSha256) throw new Error("Live configuration changed; review before preparing a guard");
  let candidate = replaceOnce(source, `route[AUTH] {
    if (is_method("REGISTER") || from_uri == myself) {
        if (!auth_check("MY_DOMAIN", "subscriber", "1")) {
            auth_challenge("MY_DOMAIN", "1");
            exit;
        }
    }
}`, `route[AUTH] {
    # Every request reaching AUTH must authenticate, regardless of its From domain.
    # The exact carrier/FreeSWITCH pilot exception is handled before route(AUTH).
    if (!auth_check("MY_DOMAIN", "subscriber", "1")) {
        auth_challenge("MY_DOMAIN", "1");
        exit;
    }
}`);
  candidate = replaceOnce(candidate, `    if (has_totag()) {
        if (loose_route()) {`, `    if (has_totag()) {
        # A forged To tag and Route header must not bypass initial-call authentication.
        if (!is_known_dlg()) {
            if (!is_method("ACK")) { sl_send_reply("481", "Call/Transaction Does Not Exist"); }
            exit;
        }
        if (loose_route()) {`);
  candidate = replaceOnce(candidate, `    # Default: relay
    route(RELAY);`, `    # A final failure ACK belongs to an existing transaction and receives no response.
    if (is_method("ACK")) {
        if (t_check_trans()) { route(RELAY); }
        exit;
    }
    # Do not act as an arbitrary out-of-dialog relay for unsupported methods.
    sl_send_reply("405", "Method Not Allowed");
    exit;`);
  return candidate;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , sourcePath, outputPath] = process.argv;
  if (!sourcePath || !outputPath) throw new Error("Usage: prepare-kamailio-auth-guard.mjs SOURCE_PRIVATE OUTPUT_PRIVATE");
  const candidate = prepareAuthGuard(readFileSync(sourcePath, "utf8"));
  writeFileSync(outputPath, candidate, { mode: 0o600, flag: "wx" });
  process.stdout.write(JSON.stringify({ sourceSha256: approvedSourceSha256, candidateSha256: sha256(candidate) }) + "\n");
}
