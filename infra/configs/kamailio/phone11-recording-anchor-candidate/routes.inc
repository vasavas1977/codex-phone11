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
    dlg_manage();
    $dlg_var(phone11_recording_anchor_a) = "1";
    # This leg terminates at FS; wake is performed on the new FS-to-phone leg.
    remove_hf("X-Phone11-Wake-ID");
    append_hf("X-Phone11-Recording-Anchor: ingress-v1\r\n");
    $ru = PHONE11_ANCHOR_FS_URI;
    $du = PHONE11_ANCHOR_FS_URI;
    if (!t_relay()) { sl_reply_error(); }
    exit;
}
# Hook INSIDE the existing authenticated is_known_dlg()/loose_route() block,
# BEFORE generic SDP/RTPengine handling. Initial A leg has no RTPengine session.
route[PHONE11_RECORDING_ANCHOR_DIALOG] {
    if ($dlg_var(phone11_recording_anchor_a) != "1") { return; }
    if (!t_relay()) { sl_reply_error(); }
    exit;
}
#!endif
