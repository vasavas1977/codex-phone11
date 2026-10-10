# Metadata-only hook. Call after verified digest auth and before credentials are
# removed in TO_FREESWITCH. No destination, dialog, or media changes are made.
#!ifdef WITH_PHONE11_OUTBOUND_RECORDING
route[PHONE11_OUTBOUND_RECORDING_IDENTITY] {
    $var(phone11_outbound_id) = $hdr(X-Phone11-Outbound-ID);
    $var(phone11_outbound_id_count) = $hdrc(X-Phone11-Outbound-ID);
    # Discard every client copy, including duplicate or differently cased names.
    remove_hf("X-Phone11-Authenticated-User");
    remove_hf("X-Phone11-Authenticated-Realm");
    remove_hf("X-Phone11-Outbound-ID");
    if (!is_method("INVITE") || has_totag()) {
        return;
    }
    if (!defined $avp(phone11_recording_auth_user) ||
        !defined $avp(phone11_recording_auth_realm)) {
        return;
    }
    if ($avp(phone11_recording_auth_user) != PHONE11_OUTBOUND_RECORDING_USER ||
        $avp(phone11_recording_auth_realm) != PHONE11_OUTBOUND_RECORDING_REALM) {
        return;
    }
    if (!defined $rU || !($rU =~ "^\\+?[0-9]{9,15}$")) {
        return;
    }
    if ($var(phone11_outbound_id_count) != 1 ||
        !defined $var(phone11_outbound_id)) {
        return;
    }
    if (!($var(phone11_outbound_id) =~ "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")) {
        return;
    }
    $var(phone11_outbound_id) = $(var(phone11_outbound_id){s.tolower});
    # The AVPs are set ONLY after auth_check succeeds, never from From/headers.
    append_hf("X-Phone11-Authenticated-User: $avp(phone11_recording_auth_user)\r\n");
    append_hf("X-Phone11-Authenticated-Realm: $avp(phone11_recording_auth_realm)\r\n");
    append_hf("X-Phone11-Outbound-ID: $var(phone11_outbound_id)\r\n");
}
#!endif
