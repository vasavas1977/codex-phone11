# IVR administration workspace scope

The admin IVR page uses the workspace selected in the admin portal. List,
detail, create, update, delete, and action replacement requests carry that
tenant ID. The server checks the caller's current active owner or admin
membership for that tenant on every IVR request, then scopes menu rows and
destination lookups to the verified tenant. The client-supplied ID never
grants access by itself.

Older detail and mutation callers may omit `tenant_id` only when the caller
has exactly one active workspace membership. A multi-workspace caller must
send an explicit ID. The admin page keys its queries by tenant and remounts
its editor on selection changes. A confirmation left open for the old page
cannot submit after that page unmounts.

This is source behavior. Hosted database state and live FreeSWITCH routing
need separate validation before claiming production acceptance.
