# Conference candidate runtime boundary

Set `PHONE11_RUNTIME_ROLE=api-candidate` only for the parallel conference API candidate. It keeps the existing HTTP routes, authentication, request context, and `/api/health` behavior, while reporting `runtimeRole: "api-candidate"` in health.

The candidate requires `PORT` to be an explicit decimal integer from 1 through 65535 and binds that exact value. It never supplies a default or searches for another port: a missing, blank, malformed, or busy port is a startup failure so a verified proxy cannot silently reach a different backend.

The candidate does not start or stop the chat-notification dispatcher, chat-media retention, recording analysis, recording retention, recording capture, the background FreeSWITCH ESL event listener, or WebSocket shutdown handling. Those remain owned by the existing default backend, which uses `PHONE11_RUNTIME_ROLE=default` (or leaves the variable unset) and retains its legacy available-port search. Existing authenticated HTTP/tRPC handlers keep their current request-scoped behavior, including request-scoped ESL actions where configured.

Only an absent role variable selects the default role. Blank, whitespace-padded, or otherwise unknown role values fail before the HTTP listener is opened. This runtime gate changes process behavior only; it does not activate a proxy route, deploy a container, change credentials, or establish conference admission or handset acceptance.
