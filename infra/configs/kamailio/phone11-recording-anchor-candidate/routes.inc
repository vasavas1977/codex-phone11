# Disabled source candidate. Hook before the current pilot ingress route, after
# existing in-dialog/CANCEL handling. Private deployment must define all macros.
#!ifdef WITH_PHONE11_RECORDING_ANCHOR
route[PHONE11_RECORDING_ANCHOR] {
    if (!is_method("INVITE") || has_totag()) { return; }
    # A returned leg may only arrive from the exact private FS socket.
    if (is_present_hf("X-Phone11-Recording-Anchor")) {
        if ($si != PHONE11_ANCHOR_FS_IP || $sp != PHONE11_ANCHOR_FS_PORT ||
            $rU != "3001" || $hdr(X-Phone11-Recording-Anchor) != "returned-v1") {
            sl_send_reply("403", "Invalid recording route"); exit;
        }
        remove_hf("X-Phone11-Recording-Anchor");
        route(PHONE11_INBOUND_PILOT);
        exit;
    }
    # No catch-all routing: all other traffic continues through its existing path.
    if ($si != PHONE11_ANCHOR_CARRIER_IP || !($rU =~ "^(\\+?6620303001|020303001)$")) { return; }
    if (!has_body("application/sdp")) { sl_send_reply("488", "SDP required"); exit; }
    dlg_manage();
    $dlg_var(phone11_recording_anchor_a) = "1";
    # This leg terminates at FS; wake is performed on the new FS-to-phone leg.
    remove_hf("X-Phone11-Wake-ID");
    append_hf("X-Phone11-Recording-Anchor: ingress-v1\r\n");
    $ru = PHONE11_ANCHOR_FS_URI;
    $du = PHONE11_ANCHOR_FS_URI;
    route(PHONE11_RECORDING_ANCHOR_OFFER);
    route(PHONE11_RECORDING_ANCHOR_RELAY);
    exit;
}
# Hook INSIDE validated known-dialog/loose_route, before generic media handling.
route[PHONE11_RECORDING_ANCHOR_DIALOG] {
    if ($dlg_var(phone11_recording_anchor_a) != "1") { return; }
    # Early-offer only: do not relay an unsupported delayed-offer renegotiation.
    if (is_method("INVITE") && !has_body("application/sdp")) {
        sl_send_reply("488", "SDP required"); exit;
    }
    if (is_method("BYE")) { rtpengine_delete(); }
    if (is_method("INVITE") && has_body("application/sdp")) {
        route(PHONE11_RECORDING_ANCHOR_OFFER);
    }
    if (is_method("ACK") && has_body("application/sdp")) {
        # SDP answer travelling in the request's direction.
        if ($si == PHONE11_ANCHOR_FS_IP && $sp == PHONE11_ANCHOR_FS_PORT) {
            $avp(phone11_anchor_origin) = "carrier";
        } else { $avp(phone11_anchor_origin) = "fs"; }
        route(PHONE11_RECORDING_ANCHOR_ANSWER);
        if ($var(anchor_media) < 0) { exit; }
    }
    route(PHONE11_RECORDING_ANCHOR_RELAY);
    exit;
}
route[PHONE11_RECORDING_ANCHOR_OFFER] {
    setflag(PHONE11_ANCHOR_FLAG);
    $avp(phone11_anchor_origin) = "carrier";
    if ($si == PHONE11_ANCHOR_FS_IP && $sp == PHONE11_ANCHOR_FS_PORT) {
        $avp(phone11_anchor_origin) = "fs";
        $var(anchor_media) = rtpengine_offer("replace-origin replace-session-connection ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=priv direction=pub address-family=IP4 codec-strip=all codec-offer=PCMA codec-offer=telephone-event");
    } else {
        $var(anchor_media) = rtpengine_offer("replace-origin replace-session-connection ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=pub direction=priv address-family=IP4 codec-strip=all codec-offer=PCMA codec-offer=telephone-event");
    }
    if ($var(anchor_media) < 0) { if (!has_totag()) { rtpengine_delete(); } sl_send_reply("503", "Media relay unavailable"); exit; }
    t_on_reply("PHONE11_RECORDING_ANCHOR_REPLY");
    t_on_failure("PHONE11_RECORDING_ANCHOR_FAILURE");
}
route[PHONE11_RECORDING_ANCHOR_ANSWER] {
    if ($avp(phone11_anchor_origin) == "fs") {
        $var(anchor_media) = rtpengine_answer("replace-origin replace-session-connection ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=pub direction=priv address-family=IP4 codec-strip=all codec-offer=PCMA codec-offer=telephone-event");
    } else {
        $var(anchor_media) = rtpengine_answer("replace-origin replace-session-connection ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=priv direction=pub address-family=IP4 codec-strip=all codec-offer=PCMA codec-offer=telephone-event");
    }
}
onreply_route[PHONE11_RECORDING_ANCHOR_REPLY] {
    if (t_check_status("[12][0-9][0-9]") && has_body("application/sdp")) {
        route(PHONE11_RECORDING_ANCHOR_ANSWER);
        if ($var(anchor_media) < 0) { drop; }
    }
}
route[PHONE11_RECORDING_ANCHOR_RELAY] {
    if (!t_relay()) { if (!has_totag()) { rtpengine_delete(); } sl_reply_error(); }
    exit;
}
# Hook only after t_lookup_cancel("1") succeeds, BEFORE existing CANCEL relay.
route[PHONE11_RECORDING_ANCHOR_CANCEL] {
    if (!has_totag() && isflagset(PHONE11_ANCHOR_FLAG)) { rtpengine_delete(); }
}
failure_route[PHONE11_RECORDING_ANCHOR_FAILURE] {
    if (!has_totag() && isflagset(PHONE11_ANCHOR_FLAG)) { rtpengine_delete(); }
}
#!endif
