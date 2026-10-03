# Applied call authentication guard

10 September 2026, 11:19 UTC. The live call router now requires authentication for all requests reaching its authentication route, regardless of the From domain. It also rejects forged unknown dialogs and unsupported out-of-dialog relaying.

The previous configuration was preserved privately. The candidate passed the deployed Kamailio 5.8.4 syntax check and 12 checks that preserved the pilot ingress condition, normal/pilot dialog management and media routes. The apply script required both zero FreeSWITCH channels and an empty successful Kamailio dialog inventory immediately before the guarded router restart. FreeSWITCH was not restarted and no calls were forcibly ended.

Applied configuration SHA256: `bb9168b3a9c312ea05267af290c3d9e581a5b31c199f905bfb410c8e986ae378`.

After activation, a no-media probe to an internal unregistered test extension received HTTP-independent SIP **407 with Proxy-Authenticate**; a forged dialog-tag probe received **481**. Neither probe called a public number. Router startup and control access passed.

These checks establish denial of the observed unauthenticated paths. They do not replace physical verification of authenticated outbound calling or incoming ACK/BYE behavior. The public-number incoming investigation remains separate: earlier failed and successful captures differed in To header, codec offer and app state. A To-normalization hypothesis has not been treated as a proven cause or applied speculatively.
