# Disabled by default. No existing Kamailio configuration includes this file.
# Include after tm/pv and before other libcurl modules; private definitions must
# supply PHONE11_WAKE_PILOT_URI, PHONE11_WAKE_API and PHONE11_WAKE_SECRET.
#!ifdef WITH_PHONE11_WAKE_CANDIDATE
loadmodule "http_async_client.so"
modparam("http_async_client", "workers", 2)
modparam("http_async_client", "connection_timeout", 28000)
modparam("http_async_client", "curl_verbose", 0)
modparam("http_async_client", "curl_follow_redirect", 0)
modparam("http_async_client", "tls_verify_host", 2)
modparam("http_async_client", "tls_verify_peer", 1)
#!endif
