import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { patchNativeLocalSdes } from "../scripts/phone11-native-local-sdes-patch.mjs";
import { patchLocalReplyNat } from "../scripts/phone11-local-reply-nat-patch.mjs";

const config = readFileSync("infra/configs/kamailio/kamailio.cfg", "utf8");
const flags =
  "replace-origin replace-session-connection ICE=remove DTLS=off rtcp-mux-demux transport-protocol=RTP/SAVP SDES-only-AES_CM_128_HMAC_SHA1_80 direction=pub direction=pub address-family=IP4";

function section(start, end) {
  const from = config.indexOf(start);
  const to = config.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing ${start}`);
  return config.slice(from, to);
}

const priorPatchedLiveShape = `request_route {
    # Handle mid-dialog requests (re-INVITE, BYE, ACK, etc.)
    if (has_totag()) {
        if (loose_route()) {
            if (is_method("INVITE")) {
                if ($dlg_var(phone11_inbound_pilot) == "1") {
                    route(PHONE11_INBOUND_OFFER);
                } else {
                    route(RTPENGINE_MANAGE);
                }
            }
            if (is_method("ACK") && has_body("application/sdp")) {
                route(RTPENGINE_MANAGE);
            }
            route(RELAY);
            exit;
        }
    }
    # CANCEL processing
    if (is_method("CANCEL")) {
        if (t_check_trans()) {
            route(RELAY);
        }
        exit;
    }

    # Handle REGISTER
}
# ---- Authentication Route ----
route[AUTH] {
    if (is_method("REGISTER") || from_uri == myself) {
        if (!auth_check("MY_DOMAIN", "subscriber", "1")) {
            auth_challenge("MY_DOMAIN", "1");
            exit;
        }
    }
}

# ---- RTPEngine Media Management (WebRTC-aware) ----
route[RTPENGINE_MANAGE] { rtpengine_manage("replace-origin ICE=remove RTP/AVP"); }
# ---- INVITE Routing ----
route[INVITE] {
    # Local extension (4-digit)
    if ($rU =~ "^[1-9][0-9]{3}$") {
        if (!lookup("location")) {
            route(RELAY);
            exit;
        }
        route(RTPENGINE_MANAGE);
        t_on_reply("LOCAL_EXTENSION_REPLY");
        route(RELAY);
        exit;
    }
    # Ring groups (*7xxx)
}
# Named reply route for registered extension-to-extension responses
onreply_route[LOCAL_EXTENSION_REPLY] {
    xlog("L_ALERT", "LOCAL_EXTENSION_REPLY status=$rs call=$ci from=$si:$sp has_sdp=$rb\\n");
    if (nat_uac_test("1")) {
        fix_nated_contact();
    }
}

# Named reply route for FreeSWITCH responses going back to WebRTC app
onreply_route[FREESWITCH_REPLY] {}
# ---- Failure Route ----
failure_route[INVITE_FAILURE] {}
`;

test("keeps a local Siprix SDES call secure through initial answer, re-INVITE, ACK, and teardown", () => {
  const localMedia = section("route[PHONE11_LOCAL_EXTENSION_MEDIA]", "# ---- INVITE Routing ----");
  const dialog = section("route[PHONE11_LOCAL_EXTENSION_DIALOG_MEDIA]", "# ---- INVITE Routing ----");
  const reply = section("onreply_route[LOCAL_EXTENSION_REPLY]", "# Named reply route for FreeSWITCH");

  assert.match(localMedia, /\$proto == "ws" \|\| \$proto == "wss"/);
  assert.match(localMedia, /search_body\("a=crypto:\.\*AES_CM_128_HMAC_SHA1_80"\)/);
  assert.ok(localMedia.includes(`rtpengine_offer("${flags}")`));
  assert.ok(reply.includes(`rtpengine_answer("${flags}")`));
  assert.ok(dialog.includes(`rtpengine_offer("${flags}")`));
  assert.ok(dialog.includes(`rtpengine_answer("${flags}")`));
  assert.match(dialog, /if \(is_method\("BYE"\)\) \{\n        rtpengine_delete\(\);/);
  assert.match(dialog, /Secure local re-INVITE requires SDP/);
  assert.match(dialog, /Secure local re-INVITE requires SDES/);
  assert.match(dialog, /PHONE11_LOCAL_EXTENSION_ACK missing_required_sdes/);
  assert.match(localMedia, /route\[PHONE11_LOCAL_EXTENSION_RELAY\][\s\S]*rtpengine_delete\(\)/);
  assert.match(config, /t_on_failure\("LOCAL_EXTENSION_FAILURE"\);\n        route\(PHONE11_LOCAL_EXTENSION_RELAY\);/);
  assert.match(reply, /fix_nated_contact\(\)/);
  assert.match(reply, /nat_uac_test\("1"\) \|\|/);
  assert.match(reply, /\$dlg_var\(phone11_local_media_profile\) == "siprix-sdes80"/);
  assert.match(reply, /t_check_status\("2\[0-9\]\[0-9\]"\)/);
  assert.match(reply, /\$ct != \$null/);
  assert.match(reply, /\$\(ct\{nameaddr\.uri\}\{uri\.host\}\) =~ "\^\[0-9\]\{1,3\}\[\.\]/);
  assert.match(reply, /nat_uac_test\("128"\) \|\| \$\(ct\{nameaddr\.uri\}\{uri\.host\}\) != \$si/);
  assert.doesNotMatch(reply, /nat_uac_test\("256"\)/);
  assert.match(reply, /missing_required_sdes/);
  assert.doesNotMatch(reply, /rtpengine_delete\(\)/);
  assert.doesNotMatch(reply, /\$rb/);
});

test("repairs only a public-looking Contact host or port mismatch in the native local 2xx path", () => {
  const reply = section("onreply_route[LOCAL_EXTENSION_REPLY]", "# Named reply route for FreeSWITCH");
  const nativeMismatchGuard = /\$dlg_var\(phone11_local_media_profile\) == "siprix-sdes80"[\s\S]*t_check_status\("2\[0-9\]\[0-9\]"\)[\s\S]*\$ct != \$null[\s\S]*\$\(ct\{nameaddr\.uri\}\{uri\.host\}\) =~ "\^\[0-9\]\{1,3\}\[\.\][\s\S]*nat_uac_test\("128"\) \|\| \$\(ct\{nameaddr\.uri\}\{uri\.host\}\) != \$si/;

  assert.match(reply, nativeMismatchGuard);
  // Source-level guardrail: FQDN contacts and non-native/failed replies stay
  // on their existing path; this special repair is for the observed IPv4 NAT
  // mismatch only.
  assert.doesNotMatch(reply, /\$dlg_var\(phone11_local_media_profile\) != "siprix-sdes80"/);
  assert.doesNotMatch(reply, /t_check_status\("\[1-6\]\[0-9\]\[0-9\]"\)/);
});

test("reply-only emergency patch handles bracketed Contact values without changing wake routes", () => {
  const emergencyRoute = `onreply_route[LOCAL_EXTENSION_REPLY] {
    if (nat_uac_test("1")) {
        fix_nated_contact();
    }
    xlog("L_INFO", "LOCAL_EXTENSION_REPLY status=$rs call=$ci from=$si:$sp\\n");
}

# Named reply route for FreeSWITCH responses going back to WebRTC app
`;
  const oldPrefix = `onreply_route[LOCAL_EXTENSION_REPLY] {
    if (nat_uac_test("1")) {
        fix_nated_contact();
    }
`;
  const patched = patchLocalReplyNat(emergencyRoute);
  const reply = patched.slice(
    patched.indexOf("onreply_route[LOCAL_EXTENSION_REPLY]"),
    patched.indexOf("# Named reply route for FreeSWITCH"),
  );

  assert.match(reply, /\$\(ct\{nameaddr\.uri\}\{uri\.host\}\)/);
  assert.doesNotMatch(reply, /\$\(ct\{uri\.host\}\)/);
  assert.equal(patchLocalReplyNat(patched), patched);
  assert.equal(
    patched,
    emergencyRoute.replace(oldPrefix, reply.slice(0, reply.indexOf('    xlog("L_INFO"'))),
  );
  assert.throws(
    () => patchLocalReplyNat(emergencyRoute.replace('nat_uac_test("1")', 'nat_uac_test("19")')),
    /NAT prefix differs/,
  );
  assert.equal(patchLocalReplyNat(config), config);
});

test("does not alter WebRTC or ordinary SIP handling outside an explicitly secure local SIP dialog", () => {
  const generic = section("route[RTPENGINE_MANAGE]", "# Native Siprix local extensions");
  const localMedia = section("route[PHONE11_LOCAL_EXTENSION_MEDIA]", "# ---- INVITE Routing ----");
  const dialogRoot = section("# Handle mid-dialog requests", "# CANCEL processing");

  assert.match(generic, /\$proto == "ws" \|\| \$proto == "wss"/);
  assert.match(generic, /rtpengine_manage/);
  assert.match(localMedia, /route\(RTPENGINE_MANAGE\);/);
  assert.match(dialogRoot, /else \{\n                    route\(RTPENGINE_MANAGE\);/);
  assert.match(dialogRoot, /\$dlg_var\(phone11_local_media_profile\) == "siprix-sdes80"/);
});

test("patches the accumulated local reply route without retaining raw SDP logging", () => {
  const patched = patchNativeLocalSdes(priorPatchedLiveShape);
  assert.match(patched, /route\(PHONE11_LOCAL_EXTENSION_MEDIA\);/);
  assert.match(patched, /route\(PHONE11_LOCAL_EXTENSION_DIALOG_MEDIA\);/);
  assert.match(patched, /SDES-only-AES_CM_128_HMAC_SHA1_80/);
  const reply = patched.slice(
    patched.indexOf("onreply_route[LOCAL_EXTENSION_REPLY]"),
    patched.indexOf("# Named reply route for FreeSWITCH"),
  );
  assert.doesNotMatch(reply, /\$rb/);
  assert.match(reply, /fix_nated_contact\(\)/);
  assert.match(reply, /\$\(ct\{nameaddr\.uri\}\{uri\.host\}\) != \$si/);
  assert.match(patched, /failure_route\[LOCAL_EXTENSION_FAILURE\]/);
  assert.equal(patchNativeLocalSdes(patched), patched);
});

test("background wake is limited to the explicit authenticated 1020/3001 pair matrix", () => {
  const wakeFixture = priorPatchedLiveShape.replace(
    "# ---- Failure Route ----",
    `route[PHONE11_WAKE_START] { }
route[PHONE11_WAKE_RESUME] {
    # Reuse the existing pilot's native/FreeSWITCH/carrier media and reply routes.
    route(PHONE11_INBOUND_OFFER);
}
route[PHONE11_WAKE_CANCEL] { }
# ---- Failure Route ----`,
  );
  const patched = patchNativeLocalSdes(wakeFixture);
  const start = patched.slice(
    patched.indexOf("route[PHONE11_LOCAL_WAKE_START] {"),
    patched.indexOf("# ---- INVITE Routing ----"),
  );
  assert.match(start, /\$rd != "sip\.phone11\.ai"/);
  assert.match(start, /phone11_recording_auth_realm\) != "sip\.phone11\.ai"/);
  assert.match(start, /\$rU == "3001" && \$avp\(phone11_recording_auth_user\) == "1020"/);
  assert.match(start, /\$rU == "1020" && \$avp\(phone11_recording_auth_user\) == "3001"/);
  assert.match(start, /\$dlg_var\(phone11_wake_target\) = PHONE11_WAKE_LOCAL_3001_URI/);
  assert.match(start, /\$dlg_var\(phone11_wake_target\) = PHONE11_WAKE_LOCAL_1020_URI/);
  assert.match(start, /else \{\s*return;/);
  assert.doesNotMatch(start, /lookup\("location"\)|\$fu|\$au/);
  assert.match(start, /route\(PHONE11_WAKE_START\)/);
  assert.match(start, /return;/);
  assert.doesNotMatch(start, /lookup\("location"\)/);
  const resume = patched.slice(
    patched.indexOf("route[PHONE11_WAKE_RESUME] {"),
    patched.indexOf("route[PHONE11_WAKE_CANCEL] {"),
  );
  assert.match(resume, /phone11_local_wake/);
  assert.match(resume, /route\(PHONE11_LOCAL_EXTENSION_MEDIA\)/);
  assert.match(resume, /Secure local media required/);
  assert.match(resume, /route\(PHONE11_WAKE_MEDIA_CLEANUP\);[\s\S]*route\(PHONE11_WAKE_TERMINAL\);[\s\S]*t_reply\("488"/);
  const auth = patched.slice(patched.indexOf("route[AUTH] {"), patched.indexOf("# ---- RTPEngine Media Management"));
  assert.ok(auth.indexOf('auth_check("MY_DOMAIN", "subscriber", "1")') < auth.indexOf("$avp(phone11_recording_auth_user) = $au;"));
  assert.ok(auth.indexOf("$avp(phone11_recording_auth_user) = $au;") < patched.indexOf("route[PHONE11_LOCAL_WAKE_START] {"));
  assert.match(auth, /#!ifdef WITH_PHONE11_WAKE_CANDIDATE[\s\S]*\$avp\(phone11_recording_auth_user\) = \$au;[\s\S]*#!endif/);
  const cancel = patched.slice(patched.indexOf("    # CANCEL processing"), patched.indexOf("    # Handle REGISTER"));
  assert.match(cancel, /if \(t_lookup_cancel\("1"\) && isflagset\(PHONE11_WAKE_FLAG\)\) \{\s*route\(PHONE11_WAKE_CANCEL\);/);
  assert.ok(cancel.indexOf('route(PHONE11_WAKE_CANCEL)') < cancel.indexOf('t_check_trans()'));
  assert.equal((cancel.match(/PHONE11_WAKE_CANCEL/g) ?? []).length, 1);
  const dialog = patched.slice(patched.indexOf("# Handle mid-dialog requests"), patched.indexOf("# CANCEL processing"));
  assert.match(dialog, /\$dlg_var\(phone11_local_wake\) == "1"[\s\S]*\$dlg_var\(phone11_wake\) == "1"[\s\S]*route\(PHONE11_WAKE_END\)/);
});

test("patches the exact checked-in template with only disabled-by-default wake hooks", () => {
  const patched = patchNativeLocalSdes(config);
  assert.equal(patchNativeLocalSdes(patched), patched);
  assert.doesNotMatch(config, /WITH_PHONE11_WAKE_CANDIDATE|PHONE11_LOCAL_WAKE_START|PHONE11_WAKE_CANCEL/);
  assert.match(patched, /#!ifdef WITH_PHONE11_WAKE_CANDIDATE[\s\S]*route\(PHONE11_LOCAL_WAKE_START\);[\s\S]*isflagset\(PHONE11_WAKE_FLAG\)/);
  assert.match(patched, /if \(t_lookup_cancel\("1"\) && isflagset\(PHONE11_WAKE_FLAG\)\) \{\s*route\(PHONE11_WAKE_CANCEL\);/);
  assert.match(patched, /if \(is_method\("BYE"\)[\s\S]*\$dlg_var\(phone11_local_wake\) == "1"[\s\S]*route\(PHONE11_WAKE_END\)/);
  assert.match(patched, /\$rU == "3001" && \$avp\(phone11_recording_auth_user\) == "1020"[\s\S]*PHONE11_WAKE_LOCAL_3001_URI[\s\S]*\$rU == "1020" && \$avp\(phone11_recording_auth_user\) == "3001"[\s\S]*PHONE11_WAKE_LOCAL_1020_URI/);
});

test("refuses a drifted local route instead of replacing an unknown production shape", () => {
  assert.throws(
    () => patchNativeLocalSdes(priorPatchedLiveShape.replace("route(RTPENGINE_MANAGE);", "route(OTHER_MEDIA);")),
    /In-dialog INVITE media branch changed|generic local-extension media route/,
  );
});
