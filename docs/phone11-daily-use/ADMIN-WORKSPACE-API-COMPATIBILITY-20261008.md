# Admin workspace API compatibility

The frozen `abca591` web candidate enabled selected-workspace Overview and
People reads. The observed PBX `c5140f4` API ignores their `tenantId` inputs and
resolves the oldest active membership. The deployed `63203` web predecessor
avoided that mismatch by admitting only one active workspace.

Admin pages now share one admission provider. It hydrates the signed-in user,
refreshes memberships, clears earlier PBX query results, and reads capabilities
before fetching tenant details. A legacy API without `explicitTenantReads: true`
admits only an account with exactly one active membership. Multiple memberships
show “Workspace API update required” before any company data or editor mounts.
No deliberate invalid-input probe or inferred version enables the picker.

The current server's strict selected-tenant router adds `explicitTenantReads:
true` to capabilities. It already validates tenant inputs and enforces current
selected administrator authority for capabilities and membership reads. This
source change does not add the bit to the deployed legacy API or authorize an
API deployment. A new server advertising the bit permits selected multi-workspace
pages only after the tenant response matches the requested ID, administrative
role, and the observed membership identities. Legacy implicit analytics and
dashboard reads remain restricted to one active membership.

Account changes, workspace changes, newer membership responses, refreshes,
read failures, cancelled requests, and mismatched IDs/roles/memberships withhold
admission. Each fresh membership observation has a separate admission query key;
a late previous response cannot admit the new scope. The shared provider avoids
child mount/refetch loops. Capability and tenant refreshes run the complete
admission check before showing data again.

“Fresh” here means a new API observation, not proof that a legacy server bypassed
its five-minute membership cache. Server-side revocation enforcement remains the
API's responsibility. Current source performs live authority checks; this web
fallback does not retrofit those checks into `c5140f4`. Normal authenticated
navigation on that legacy API may refresh an existing sign-in session.

Validation covers legacy ignored inputs, selected explicit APIs, wrong-company
responses, changed roles/memberships, account and selected-workspace changes,
refresh/failure states, cancellation, and cache retirement. Server contract
tests exercise strict inputs and selected authority alongside the additive bit.
Source/tests do not establish live API compatibility, deployment, provider,
calling, or physical-device acceptance. The retained `abca591` export is unchanged;
a reviewed, committed correction needs a new source-bound export before cutover.

At `402c1ec`, CI found two stale exact-response assertions in the read-revocation
suite: admitted admin/owner capabilities now include `explicitTenantReads: true`.
Those assertions retain exact equality with the additive field; the schema fixture
still returns only `phoneNumbers: false`, proving the router supplies the contract
bit. All cache-invalidation race, demotion, removal, cross-workspace, failed-lookup,
and query-scope assertions remain unchanged. No hook or authority behavior changed.
The completed `402c1ec` export remains frozen as failed-source CI evidence.
