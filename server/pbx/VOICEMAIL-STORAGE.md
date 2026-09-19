# Phone11 voicemail inbox storage contract

The Phone11 app now has a real voicemail inbox and private playback route, but
the FreeSWITCH voicemail module does not upload its completed audio to the API
by itself. Do not mark voicemail ready in a tenant until the following are
completed through the normal deployment process:

1. Review and apply `voicemail-storage-migration.sql` to the Phone11 PBX
   database.
2. Provide durable, writable `VOICEMAIL_PATH` storage to the Phone11 backend.
   The backend container's local filesystem is not durable unless its volume is
   mounted or replaced by a reviewed object-store adapter.
3. Configure a trusted FreeSWITCH-side relay to upload each completed WAV over
   TLS to `POST /api/recordings/voicemail`. The relay must send the configured
   `x-fs-secret`; never put that secret in a query string or client app.
4. Test a new voicemail with an assigned, voicemail-enabled extension and a
   different tenant. Verify list, playback, read, delete, and cross-tenant
   denial on a physical signed build.

## Upload request

The endpoint accepts only a WAV body and the following query values:

| Field | Required | Rules |
| --- | --- | --- |
| `tenant_id` | yes | Active tenant numeric ID |
| `extension` | yes | Active voicemail-enabled destination extension |
| `message_uuid` | yes | Stable relay-generated identifier for retries |
| `caller_number` | yes | Up to 64 printable characters |
| `caller_name` | no | Up to 160 printable characters |
| `duration_seconds` | no | Whole seconds from 0 through 86,400 |

The same `tenant_id` and `message_uuid` may be retried only with byte-identical
audio. The server keeps voicemail media in a tenant-only path and requires an
explicit assigned extension before list, playback, read, or delete. It returns
an unavailable response when the database migration has not been applied;
clients must not display that state as an empty inbox.
