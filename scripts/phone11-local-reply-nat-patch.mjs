import { readFileSync, writeFileSync } from "node:fs";

const ROUTE = "LOCAL_EXTENSION_REPLY";
const START = `onreply_route[${ROUTE}] {\n`;
const END = "# Named reply route for FreeSWITCH responses going back to WebRTC app\n";
const LEGACY_GUARD = `    if (nat_uac_test("1")) {\n        fix_nated_contact();\n    }\n`;
const NATIVE_GUARD = `    # nat_uac_test("1") catches private Contacts, but cannot see a
    # public-looking Contact whose host or port differs from this reply's
    # source. Keep that repair inside the native local dialog that needs
    # symmetric signaling.
    if (nat_uac_test("1") ||
        ($dlg_var(phone11_local_media_profile) == "siprix-sdes80" &&
         t_check_status("2[0-9][0-9]") &&
         $ct != $null &&
         $(ct{nameaddr.uri}{uri.host}) =~ "^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$" &&
         (nat_uac_test("128") || $(ct{nameaddr.uri}{uri.host}) != $si))) {
        fix_nated_contact();
    }
`;

function localReplyRoute(source) {
  const start = source.indexOf(START);
  const end = source.indexOf(END, start);
  if (start < 0 || end <= start) throw new Error("Local extension reply route markers not found");
  return { start, end, text: source.slice(start, end) };
}

/**
 * Patch only the NAT prefix of the named local-extension reply route. This is
 * deliberately separate from the SDES/wake patcher so an emergency NAT repair
 * cannot enable or modify the pending wake candidate.
 */
export function patchLocalReplyNat(source) {
  if (typeof source !== "string") throw new TypeError("Kamailio config must be text");
  const route = localReplyRoute(source);
  if (route.text.includes(NATIVE_GUARD)) return source;
  if (!route.text.startsWith(START + LEGACY_GUARD)) {
    throw new Error("Local extension reply NAT prefix differs; refusing to patch");
  }
  const replacement = START + NATIVE_GUARD + route.text.slice((START + LEGACY_GUARD).length);
  return source.slice(0, route.start) + replacement + source.slice(route.end);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error("Usage: node phone11-local-reply-nat-patch.mjs INPUT OUTPUT");
    process.exitCode = 64;
  } else {
    const before = readFileSync(input, "utf8");
    const after = patchLocalReplyNat(before);
    writeFileSync(output, after, { mode: 0o600 });
    console.log(`phone11_local_reply_nat_patch=${after === before ? "already-applied" : "updated"}`);
  }
}
