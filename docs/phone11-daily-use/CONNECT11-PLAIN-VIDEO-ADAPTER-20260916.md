# Phone11 plain-video adapter boundary

Phone11 has an unmounted adapter for Connect11's `phone11-plain-video.v1`
contract. It is independent of the existing interpreter-enabled
`phone11-conference.v1` path and does not loosen that path's consent or agent
requirements.

The server-only facade uses dedicated status and join credentials and only
accepts a trusted admission containing an opaque meeting ID, participant ID and
authorized `interactive` or `listener` profile. It rejects client fields for
rooms, identities, tenants, credentials, consent, language, agents, TTL and
provider controls. It sends no token to a client until Connect11 reports an
available, exact contract with a secure, short-lived RTC token.

The adapter is intentionally not mounted in `meetingsRouter`. A Phone11-side
resolver still needs durable authorization for active tenant membership, meeting
membership, lobby approval, revocation and permitted profile. It must choose a
customer-scoped credential server-side. The user must not select a customer or
profile in the app.

Before activation, prove Connect11's deployed issuer isolation, no automatic
agents, and a two-participant audio/video test with restricted grants. Then
prove Phone11's native SDK compatibility alongside Siprix, permissions, leave,
reconnect, background behavior and signed handset media. Do not use generic or
demo routes as a fallback. Interpretation remains separately disabled.
