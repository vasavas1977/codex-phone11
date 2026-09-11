# Source-only candidate. Requires explicit private WITH_PHONE11_WAKE_CANDIDATE.
# PHONE11_WAKE_FLAG must be an independently verified unused transaction flag.
#!ifdef WITH_PHONE11_WAKE_CANDIDATE
route[PHONE11_WAKE_START] {
    # Call only from the existing, source-authorized PHONE11_INBOUND_PILOT route
    # AFTER its exact destination rewrite and BEFORE its location lookup.
    if (!is_method("INVITE") || has_totag() || $ru != PHONE11_WAKE_PILOT_URI) {
        return;
    }
    if ($ci == $null || $(ci{s.len}) > 512 || !($ci =~ "^[!-~]+$")) {
        sl_send_reply("400", "Invalid Call-ID");
        exit;
    }
    remove_hf("X-Phone11-Wake-ID");
    setflag(PHONE11_WAKE_FLAG);
    $dlg_var(phone11_wake) = "1";
    if (!t_newtran()) { exit; }
    t_set_fr(30000, 30000);
    t_set_max_lifetime(60000, 30000);
    t_on_failure("PHONE11_WAKE_FAILURE");
    $var(wake_body) = "{}";
    jansson_set("string", "sipUri", PHONE11_WAKE_PILOT_URI, "$var(wake_body)");
    jansson_set("string", "sipCallId", "$ci", "$var(wake_body)");
    $http_req(all) = $null;
    $http_req(method) = "POST";
    $http_req(hdr) = "Content-Type: application/json";
    $http_req(hdr) = "X-Push-Secret: " + PHONE11_WAKE_SECRET;
    $http_req(body) = $var(wake_body);
    $http_req(timeout) = 28000;
    # Existing transaction is automatically suspended; success stops this route.
    $var(wake_url) = PHONE11_WAKE_API + "/offer";
    http_async_query("$var(wake_url)", "PHONE11_WAKE_RESUME");
    # Reached only when the asynchronous request could not be started.
    t_reply("503", "Incoming call service unavailable");
    exit;
}

route[PHONE11_WAKE_RESUME] {
    if (t_is_canceled()) {
        $var(wake_terminal) = "cancelled";
        route(PHONE11_WAKE_TERMINAL);
        exit;
    }
    if (t_is_expired()) { exit; }
    $var(wake_status) = $null;
    $var(wake_version) = $null;
    $var(wake_uuid) = $null;
    if ($http_ok && $http_rs == 200 && $http_bs <= 4096) {
        jansson_get("status", "$http_rb", "$var(wake_status)");
        jansson_get("v", "$http_rb", "$var(wake_version)");
        jansson_get("callUUID", "$http_rb", "$var(wake_uuid)");
    }
    if ($var(wake_status) != "ready" || $var(wake_version) != 1 || $var(wake_uuid) == $null || !($var(wake_uuid) =~ "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")) {
        $var(wake_terminal) = "cancelled";
        route(PHONE11_WAKE_TERMINAL);
        t_reply("480", "Phone unavailable");
        exit;
    }
    # Preserve the real original INVITE/Call-ID/SDP. Never originate another call.
    $ru = PHONE11_WAKE_PILOT_URI;
    $du = $null;
    if (!lookup("location")) {
        $var(wake_terminal) = "cancelled";
        route(PHONE11_WAKE_TERMINAL);
        t_reply("480", "Phone registration unavailable");
        exit;
    }
    # Correlate only the server-generated wake UUID; discard caller-supplied copies.
    remove_hf("X-Phone11-Wake-ID");
    append_hf("X-Phone11-Wake-ID: $var(wake_uuid)\r\n");
    # Reuse the existing pilot's native/FreeSWITCH/carrier media and reply routes.
    route(PHONE11_INBOUND_OFFER);
    route(RELAY);
    exit;
}

# Hook from the EXISTING CANCEL path only after t_lookup_cancel("1") succeeds
# and isflagset(PHONE11_WAKE_FLAG). It must still run normal t_check_trans/RELAY.
route[PHONE11_WAKE_CANCEL] {
    $var(wake_terminal) = "cancelled";
    route(PHONE11_WAKE_TERMINAL);
    return;
}

# Hook from the existing validated in-dialog BYE path when dlg_var(phone11_wake)
# equals "1". Preserve the existing RTPEngine cleanup and BYE relay.
route[PHONE11_WAKE_END] {
    $var(wake_terminal) = "ended";
    route(PHONE11_WAKE_TERMINAL);
    return;
}

failure_route[PHONE11_WAKE_FAILURE] {
    $var(wake_terminal) = "ended";
    if (t_is_canceled()) { $var(wake_terminal) = "cancelled"; }
    route(PHONE11_WAKE_TERMINAL);
}

route[PHONE11_WAKE_TERMINAL] {
    $var(wake_body) = "{}";
    jansson_set("string", "sipUri", PHONE11_WAKE_PILOT_URI, "$var(wake_body)");
    jansson_set("string", "sipCallId", "$ci", "$var(wake_body)");
    jansson_set("string", "status", "$var(wake_terminal)", "$var(wake_body)");
    $http_req(all) = $null;
    $http_req(method) = "POST";
    $http_req(hdr) = "Content-Type: application/json";
    $http_req(hdr) = "X-Push-Secret: " + PHONE11_WAKE_SECRET;
    $http_req(body) = $var(wake_body);
    $http_req(timeout) = 2000;
    $http_req(suspend) = 0;
    $var(wake_url) = PHONE11_WAKE_API + "/terminal";
    http_async_query("$var(wake_url)", "PHONE11_WAKE_TERMINAL_RESULT");
    return;
}

route[PHONE11_WAKE_TERMINAL_RESULT] {
    # Best-effort notification; never resume/relay/end a SIP call from this callback.
    # Backend call TTL and device heartbeat remain the fallback on HTTP failure.
    return;
}
#!endif
