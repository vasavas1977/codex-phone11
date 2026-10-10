import { readFileSync, writeFileSync } from "node:fs";

const PROFILE = "siprix-sdes80";
const MEDIA_ROUTE = "PHONE11_LOCAL_EXTENSION_MEDIA";
const DIALOG_ROUTE = "PHONE11_LOCAL_EXTENSION_DIALOG_MEDIA";
const REPLY_ROUTE = "LOCAL_EXTENSION_REPLY";
const LOCAL_WAKE_ROUTE = "PHONE11_LOCAL_WAKE_START";
const AUTH_USER_AVP = "phone11_recording_auth_user";
const AUTH_REALM_AVP = "phone11_recording_auth_realm";
const LOCAL_1020_URI = "PHONE11_WAKE_LOCAL_1020_URI";
const LOCAL_3001_URI = "PHONE11_WAKE_LOCAL_3001_URI";
const SDES_FLAGS =
  "replace-origin replace-session-connection ICE=remove DTLS=off rtcp-mux-demux transport-protocol=RTP/SAVP SDES-only-AES_CM_128_HMAC_SHA1_80 direction=pub direction=pub address-family=IP4";

const mediaRoute = `# Native Siprix local extensions that explicitly offer SDES keep AES_CM_128_HMAC_SHA1_80 end-to-end.
# WebRTC and ordinary SIP keep the existing generic media route.
route[${MEDIA_ROUTE}] {
    if ($proto == "ws" || $proto == "wss" || !has_body("application/sdp") || !search_body("a=crypto:.*AES_CM_128_HMAC_SHA1_80")) {
        route(RTPENGINE_MANAGE);
        return;
    }
    $dlg_var(phone11_local_media_profile) = "${PROFILE}";
    $avp(phone11_local_media_failed) = "0";
    $var(phone11_local_rtpe) = rtpengine_offer("${SDES_FLAGS}");
    if ($var(phone11_local_rtpe) < 0) {
        $avp(phone11_local_media_failed) = "1";
        return;
    }
}

route[${DIALOG_ROUTE}] {
    if ($dlg_var(phone11_local_media_profile) != "${PROFILE}") {
        route(RTPENGINE_MANAGE);
        return;
    }
    if (is_method("BYE")) {
        rtpengine_delete();
        return;
    }
    if (is_method("INVITE") && !has_body("application/sdp")) {
        sl_send_reply("488", "Secure local re-INVITE requires SDP");
        exit;
    }
    if (is_method("INVITE") && !search_body("a=crypto:.*AES_CM_128_HMAC_SHA1_80")) {
        sl_send_reply("488", "Secure local re-INVITE requires SDES");
        exit;
    }
    if (is_method("INVITE")) {
        $avp(phone11_local_media_failed) = "0";
        $var(phone11_local_rtpe) = rtpengine_offer("${SDES_FLAGS}");
        if ($var(phone11_local_rtpe) < 0) {
            $avp(phone11_local_media_failed) = "1";
            return;
        }
        t_on_reply("${REPLY_ROUTE}");
        return;
    }
    if (is_method("ACK") && has_body("application/sdp")) {
        if (!search_body("a=crypto:.*AES_CM_128_HMAC_SHA1_80")) {
            xlog("L_WARN", "PHONE11_LOCAL_EXTENSION_ACK missing_required_sdes call=$ci\\n");
            drop;
        }
        # ACK carries the SDP answer after a secure re-INVITE response.
        $var(phone11_local_rtpe) = rtpengine_answer("${SDES_FLAGS}");
        if ($var(phone11_local_rtpe) < 0) {
            drop;
        }
    }
}

route[PHONE11_LOCAL_EXTENSION_RELAY] {
    if (!t_relay()) {
        rtpengine_delete();
        sl_reply_error();
    }
    exit;
}

`;

// This is the exact SDES route currently checked in before the wake candidate
// adds its non-exiting offer failure signal. Accept no other existing shape.
const legacyMediaRoute = mediaRoute.replaceAll(
  `    $dlg_var(phone11_local_media_profile) = "${PROFILE}";
    $avp(phone11_local_media_failed) = "0";
    $var(phone11_local_rtpe) = rtpengine_offer("${SDES_FLAGS}");
    if ($var(phone11_local_rtpe) < 0) {
        $avp(phone11_local_media_failed) = "1";
        return;
    }`,
  `    $dlg_var(phone11_local_media_profile) = "${PROFILE}";
    $var(phone11_local_rtpe) = rtpengine_offer("${SDES_FLAGS}");
    if ($var(phone11_local_rtpe) < 0) {
        sl_send_reply("503", "Secure local media unavailable");
        exit;
    }`,
).replace(
  `    if (is_method("INVITE")) {
        $avp(phone11_local_media_failed) = "0";
        $var(phone11_local_rtpe) = rtpengine_offer("${SDES_FLAGS}");
        if ($var(phone11_local_rtpe) < 0) {
            $avp(phone11_local_media_failed) = "1";
            return;
        }`,
  `    if (is_method("INVITE")) {
        $var(phone11_local_rtpe) = rtpengine_offer("${SDES_FLAGS}");
        if ($var(phone11_local_rtpe) < 0) {
            sl_send_reply("503", "Secure local media unavailable");
            exit;
        }`,
);

const localWakeRoute = `#!ifdef WITH_PHONE11_WAKE_CANDIDATE
route[${LOCAL_WAKE_ROUTE}] {
    if (!is_method("INVITE") || has_totag() || $rd != "sip.phone11.ai" ||
        !defined $avp(${AUTH_USER_AVP}) ||
        !defined $avp(${AUTH_REALM_AVP}) || $avp(${AUTH_REALM_AVP}) != "sip.phone11.ai") {
        return;
    }
    # This is a closed two-account matrix. The target comes from private
    # deployment macros, never a caller URI or an inferred tenant/account.
    if ($rU == "3001" && $avp(${AUTH_USER_AVP}) == "1020") {
        $dlg_var(phone11_wake_target) = ${LOCAL_3001_URI};
    } else if ($rU == "1020" && $avp(${AUTH_USER_AVP}) == "3001") {
        $dlg_var(phone11_wake_target) = ${LOCAL_1020_URI};
    } else {
        return;
    }
    $avp(phone11_local_wake) = "1";
    $dlg_var(phone11_local_wake) = "1";
    $ru = $dlg_var(phone11_wake_target);
    route(PHONE11_WAKE_START);
}
#!endif
`;

const replyRoute = `# Named reply route for registered extension-to-extension responses.
# Keep logs to metadata: raw SDP can carry cryptographic key material.
onreply_route[${REPLY_ROUTE}] {
    # nat_uac_test("1") catches private Contacts, but cannot see a
    # public-looking Contact whose host or port differs from this reply's
    # source. Keep that repair inside the native local dialog that needs
    # symmetric signaling.
    if (nat_uac_test("1") ||
        ($dlg_var(phone11_local_media_profile) == "${PROFILE}" &&
         t_check_status("2[0-9][0-9]") &&
         $ct != $null &&
         $(ct{nameaddr.uri}{uri.host}) =~ "^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$" &&
         (nat_uac_test("128") || $(ct{nameaddr.uri}{uri.host}) != $si))) {
        fix_nated_contact();
    }
    if ($dlg_var(phone11_local_media_profile) == "${PROFILE}" && t_check_status("(1[0-9][0-9])|(2[0-9][0-9])") && has_body("application/sdp")) {
        if (!search_body("a=crypto:.*AES_CM_128_HMAC_SHA1_80")) {
            xlog("L_WARN", "PHONE11_LOCAL_EXTENSION_REPLY missing_required_sdes status=$rs call=$ci\\n");
            drop;
        }
        $var(phone11_local_rtpe) = rtpengine_answer("${SDES_FLAGS}");
        if ($var(phone11_local_rtpe) < 0) { drop; }
    }
    if ($dlg_var(phone11_local_media_profile) == "${PROFILE}" &&
        t_check_status("[3-6][0-9][0-9]") &&
        $dlg_var(phone11_wake) != "1") {
        rtpengine_delete();
    }
    xlog("L_INFO", "PHONE11_LOCAL_EXTENSION_REPLY status=$rs call=$ci profile=$dlg_var(phone11_local_media_profile) from=$si:$sp\\n");
}

`;

function between(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Expected ${label} markers not found`);
  }
  return { start, end, text: source.slice(start, end) };
}

function replaceSection(source, section, replacement) {
  return source.slice(0, section.start) + replacement + source.slice(section.end);
}

function patchLocalInvite(source) {
  const section = between(
    source,
    "    # Local extension (4-digit)\n",
    "    # Ring groups (*7xxx)\n",
    "local-extension route",
  );
  let text = section.text;
  const wakeHook = `#!ifdef WITH_PHONE11_WAKE_CANDIDATE
        route(${LOCAL_WAKE_ROUTE});
        if (isflagset(PHONE11_WAKE_FLAG)) { exit; }
#!endif
`;
  if (!text.includes(wakeHook)) {
    const anchor = "    if ($rU =~ \"^[1-9][0-9]{3}$\") {\n";
    if (!text.includes(anchor)) throw new Error("Local extension wake-hook anchor changed");
    text = text.replace(anchor, `${anchor}${wakeHook}`);
  }
  const generic = "        route(RTPENGINE_MANAGE);";
  const dedicated = `        route(${MEDIA_ROUTE});`;
  if (text.includes(dedicated)) {
    if (text.includes(generic)) throw new Error("Local extension route has conflicting media routes");
  } else {
    if ((text.match(/route\(RTPENGINE_MANAGE\);/g) || []).length !== 1) {
      throw new Error("Expected exactly one generic local-extension media route");
    }
    text = text.replace(generic, dedicated);
  }
  const replyHook = `        t_on_reply("${REPLY_ROUTE}");`;
  if (!text.includes(replyHook)) {
    const anchor = `${dedicated}\n        route(RELAY);`;
    if (!text.includes(anchor)) throw new Error("Local extension reply-hook anchor changed");
    text = text.replace(anchor, `${dedicated}\n${replyHook}\n        route(RELAY);`);
  }
  const failureHook = "        t_on_failure(\"LOCAL_EXTENSION_FAILURE\");";
  if (!text.includes(failureHook)) {
    const anchor = `${replyHook}\n        route(RELAY);`;
    if (!text.includes(anchor)) throw new Error("Local extension failure-hook anchor changed");
    text = text.replace(anchor, `${replyHook}\n${failureHook}\n        route(RELAY);`);
  }
  const localRelay = "        route(PHONE11_LOCAL_EXTENSION_RELAY);";
  if (!text.includes(localRelay)) {
    const anchor = `${failureHook}\n        route(RELAY);`;
    if (!text.includes(anchor)) throw new Error("Local extension relay anchor changed");
    text = text.replace(anchor, `${failureHook}\n${localRelay}`);
  }
  const mediaFailure = `        if ($avp(phone11_local_media_failed) == "1") {
            sl_send_reply("503", "Secure local media unavailable");
            exit;
        }
`;
  if (!text.includes(mediaFailure)) {
    const anchor = `${dedicated}\n`;
    if (!text.includes(anchor)) throw new Error("Local extension media-failure anchor changed");
    text = text.replace(anchor, `${dedicated}\n${mediaFailure}`);
  }
  return replaceSection(source, section, text);
}

function patchInDialog(source) {
  const section = between(
    source,
    "    # Handle mid-dialog requests (re-INVITE, BYE, ACK, etc.)\n",
    "    # CANCEL processing\n",
    "in-dialog route",
  );
  let text = section.text;
  const wakeEndHook = `#!ifdef WITH_PHONE11_WAKE_CANDIDATE
            if (is_method("BYE") &&
                $dlg_var(phone11_local_wake) == "1" &&
                $dlg_var(phone11_wake) == "1") {
                route(PHONE11_WAKE_END);
            }
#!endif
`;
  const relay = "            route(RELAY);\n            exit;";
  if (text.includes(`route(${DIALOG_ROUTE});`)) {
    if (!text.includes(wakeEndHook)) {
      if (!text.includes(relay)) throw new Error("In-dialog relay anchor changed");
      text = text.replace(relay, wakeEndHook + relay);
    }
    return replaceSection(source, section, text);
  }

  const invite = `            if (is_method("INVITE")) {
                if ($dlg_var(phone11_inbound_pilot) == "1") {
                    route(PHONE11_INBOUND_OFFER);
                } else {
                    route(RTPENGINE_MANAGE);
                }
            }`;
  const patchedInvite = `            if (is_method("INVITE")) {
                if ($dlg_var(phone11_inbound_pilot) == "1") {
                    route(PHONE11_INBOUND_OFFER);
                } else if ($dlg_var(phone11_local_media_profile) == "${PROFILE}") {
                    route(${DIALOG_ROUTE});
                } else {
                    route(RTPENGINE_MANAGE);
                }
            }`;
  if (!text.includes(invite)) throw new Error("In-dialog INVITE media branch changed");
  text = text.replace(invite, patchedInvite);

  const ack = `            if (is_method("ACK") && has_body("application/sdp")) {
                route(RTPENGINE_MANAGE);
            }`;
  const patchedAck = `            if (is_method("ACK") && has_body("application/sdp")) {
                if ($dlg_var(phone11_local_media_profile) == "${PROFILE}") {
                    route(${DIALOG_ROUTE});
                } else {
                    route(RTPENGINE_MANAGE);
                }
            }`;
  if (!text.includes(ack)) throw new Error("In-dialog ACK media branch changed");
  text = text.replace(ack, patchedAck);

  const patchedRelay = `            if (is_method("BYE") && $dlg_var(phone11_local_media_profile) == "${PROFILE}") {
                route(${DIALOG_ROUTE});
            }
${wakeEndHook}${relay}`;
  if (!text.includes(relay)) throw new Error("In-dialog relay anchor changed");
  text = text.replace(relay, patchedRelay);
  return replaceSection(source, section, text);
}

function patchCancelRoute(source) {
  const section = between(
    source,
    "    # CANCEL processing\n",
    "    # Handle REGISTER\n",
    "CANCEL route",
  );
  const hook = `#!ifdef WITH_PHONE11_WAKE_CANDIDATE
        # A matching wake transaction needs its terminal callback before the
        # ordinary CANCEL relay. Unmatched CANCELs retain the existing path.
        if (t_lookup_cancel("1") && isflagset(PHONE11_WAKE_FLAG)) {
            route(PHONE11_WAKE_CANCEL);
        }
#!endif
`;
  if (section.text.includes(hook)) return source;
  const legacy = `    # CANCEL processing
    if (is_method("CANCEL")) {
        if (t_check_trans()) {
            route(RELAY);
        }
        exit;
    }

`;
  if (section.text !== legacy) {
    throw new Error("CANCEL route differs; refusing to add wake cleanup hook");
  }
  return replaceSection(
    source,
    section,
    legacy.replace('    if (is_method("CANCEL")) {\n', `    if (is_method("CANCEL")) {\n${hook}`),
  );
}

function patchAuthenticatedCallerAvps(source) {
  const route = `route[AUTH] {
    if (is_method("REGISTER") || from_uri == myself) {
        if (!auth_check("MY_DOMAIN", "subscriber", "1")) {
            auth_challenge("MY_DOMAIN", "1");
            exit;
        }
        # Bind the local wake gate to the credentials that auth_check accepted.
        # These request AVPs are deliberately set only after authentication.
#!ifdef WITH_PHONE11_WAKE_CANDIDATE
        $avp(${AUTH_USER_AVP}) = $au;
        $avp(${AUTH_REALM_AVP}) = $ar;
#!endif
    }
}
`;
  const start = "route[AUTH] {";
  const end = "# ---- RTPEngine Media Management (WebRTC-aware) ----\n";
  const section = between(source, start, end, "authentication route");
  if (section.text === route + "\n") return source;
  const legacy = `route[AUTH] {
    if (is_method("REGISTER") || from_uri == myself) {
        if (!auth_check("MY_DOMAIN", "subscriber", "1")) {
            auth_challenge("MY_DOMAIN", "1");
            exit;
        }
    }
}

`;
  if (section.text !== legacy) throw new Error("Authentication route differs; refusing to bind wake caller AVPs");
  return replaceSection(source, section, route + "\n");
}

function patchWakeResume(source) {
  const anchor = "    # Reuse the existing pilot's native/FreeSWITCH/carrier media and reply routes.\n    route(PHONE11_INBOUND_OFFER);";
  if (source.includes("if ($dlg_var(phone11_local_wake) == \"1\"")) return source;
  // Older isolated parser fixtures do not include the optional wake module.
  if (!source.includes(anchor)) return source;
  const replacement = `    # Closed local 1020/3001 wake calls resume through the native Siprix SDES route.
    # Carrier/FreeSWITCH pilot calls retain their existing media contract.
    if ($dlg_var(phone11_local_wake) == "1") {
        if (!has_body("application/sdp") ||
            !search_body("a=crypto:.*AES_CM_128_HMAC_SHA1_80")) {
            route(PHONE11_WAKE_MEDIA_CLEANUP);
            $var(wake_terminal) = "cancelled";
            route(PHONE11_WAKE_TERMINAL);
            t_reply("488", "Secure local media required");
            exit;
        }
        route(${MEDIA_ROUTE});
        if ($avp(phone11_local_media_failed) == "1" ||
            $dlg_var(phone11_local_media_profile) != "${PROFILE}") {
            route(PHONE11_WAKE_MEDIA_CLEANUP);
            $var(wake_terminal) = "cancelled";
            route(PHONE11_WAKE_TERMINAL);
            t_reply("503", "Secure local media unavailable");
            exit;
        }
        t_on_reply("${REPLY_ROUTE}");
    } else {
        route(PHONE11_INBOUND_OFFER);
    }`;
  return source.replace(anchor, replacement);
}

function patchMediaRoutes(source) {
  const marker = "# ---- INVITE Routing ----\n";
  if (!source.includes(marker)) throw new Error("INVITE route marker not found");
  if (source.includes(`route[${MEDIA_ROUTE}] {`)) {
    const section = between(
      source,
      "# Native Siprix local extensions that explicitly offer SDES keep AES_CM_128_HMAC_SHA1_80 end-to-end.\n",
      "# ---- INVITE Routing ----\n",
      "native local media route",
    );
    if (section.text === mediaRoute + localWakeRoute) return source;
    if (section.text === legacyMediaRoute) {
      return replaceSection(source, section, mediaRoute + localWakeRoute);
    }
    throw new Error("Existing native local media route differs");
  }
  return source.replace(marker, mediaRoute + localWakeRoute + marker);
}

function patchReplyRoute(source) {
  const marker = "# Named reply route for FreeSWITCH responses going back to WebRTC app\n";
  if (!source.includes(marker)) throw new Error("FreeSWITCH reply route marker not found");
  const startMarker = `onreply_route[${REPLY_ROUTE}] {`;
  if (source.includes(startMarker)) {
    const canonicalComment = "# Named reply route for registered extension-to-extension responses.\n";
    const start = source.lastIndexOf(canonicalComment, source.indexOf(startMarker));
    const section = between(
      source,
      start >= 0 ? canonicalComment : startMarker,
      marker,
      "local extension reply route",
    );
    if (!section.text.includes("fix_nated_contact")) throw new Error("Local reply route NAT guard missing");
    return replaceSection(source, section, replyRoute);
  }
  return source.replace(marker, replyRoute + marker);
}

function patchFailureRoute(source) {
  const marker = "# ---- Failure Route ----\n";
  const failureRoute = `failure_route[LOCAL_EXTENSION_FAILURE] {
    if ($dlg_var(phone11_local_media_profile) == "${PROFILE}") {
        rtpengine_delete();
    }
}

`;
  if (!source.includes(marker)) throw new Error("Failure route marker not found");
  if (source.includes("failure_route[LOCAL_EXTENSION_FAILURE] {")) {
    const section = between(source, "failure_route[LOCAL_EXTENSION_FAILURE] {", marker, "local extension failure route");
    if (section.text !== failureRoute) throw new Error("Existing local extension failure route differs");
    return source;
  }
  return source.replace(marker, failureRoute + marker);
}

/**
 * Patch only the audited local-extension path. It refuses unknown shapes so a
 * deployment script cannot silently overwrite accumulated production changes.
 */
export function patchNativeLocalSdes(source) {
  if (typeof source !== "string") throw new TypeError("Kamailio config must be text");
  let patched = patchAuthenticatedCallerAvps(source);
  patched = patchLocalInvite(patched);
  patched = patchInDialog(patched);
  patched = patchCancelRoute(patched);
  patched = patchMediaRoutes(patched);
  patched = patchWakeResume(patched);
  patched = patchReplyRoute(patched);
  patched = patchFailureRoute(patched);
  if (patched.includes("LOCAL_EXTENSION_REPLY status=$rs call=$ci from=$si:$sp has_sdp=$rb")) {
    throw new Error("Raw SDP logging remains in local extension reply route");
  }
  return patched;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error("Usage: node phone11-native-local-sdes-patch.mjs INPUT OUTPUT");
    process.exitCode = 64;
  } else {
    const before = readFileSync(input, "utf8");
    const after = patchNativeLocalSdes(before);
    writeFileSync(output, after, { mode: 0o600 });
    console.log(`phone11_native_local_sdes_patch=${after === before ? "already-applied" : "updated"}`);
  }
}
