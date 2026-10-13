# Extension administration action boundary

Extension creation and assignment use the server's explicit `tenantId` API and
require admitted administrator access. This source change adds a client action
boundary; the server remains authoritative for every write.

Before starting a write, `useAdminActionScope` checks the live authenticated
session identity, selected tenant, admission scope, and cached active owner/admin
membership. It reserves the action synchronously so repeated presses cannot
dispatch duplicate writes before the mutation hook renders its pending state.
Session replacement, authentication checking, membership revocation, workspace
reverification, and component unmount retire retained handlers.

The extension screen also binds each Save handler to its current editor lifetime
and current form values. Assignment requires a successfully loaded, idle
extension inventory, an unchanged extension row, and successfully loaded, idle
active people. A selected person who disappears from the refreshed list cannot
be submitted. Unassignment still uses explicit `userId: null` and the same fresh
workspace and inventory checks.

Late success or failure can update the screen only while the reserved action's
session, workspace, and editor remain current. Successful current assignments
close the editor before best-effort exact inventory/people invalidation. The screen
opts out of shared mutation-hook invalidation, so late hook completion cannot
schedule refresh independently of the reserved action. Current creation refreshes
its exact inventory page and, only under current single-workspace admission, the
legacy implicit dashboard statistics query. Current assignment refreshes the exact
inventory page that supplied its edited row and the selected tenant people query.
Each refresh rechecks the action scope; it does not broadly invalidate another
workspace or another inventory page. The two shared mutation hooks preserve their
default invalidation behavior for other consumers. Failed current
assignments keep the selection and error visible for a deliberate retry.

Behavioral coverage is in `tests/phone11-admin-extension-actions.test.tsx`, with
the real shared mutation hooks exercised through a mocked transport and the
existing pagination and extension API/source tests retained. This change does
not enable Phone Numbers, IVR, Ring Groups, Queues, or Business Hours. Those
sections still require server-confirmed capabilities and their separate
commissioning/deployment gates. Source checks and a local build do not establish
live deployment, provider behavior, or phone acceptance.
