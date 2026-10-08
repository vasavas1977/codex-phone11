# Phone11 commissioning with the owner

The owner answered “me” when asked who will review the PBX configuration. The
owner also confirmed that a telecom engineer is available. The owner is the
reviewer; the engineer's operator and credential-custody responsibilities still
need to be mapped to the actual change. These are operational assignments, not a
missing product decision about who can review.

## Target to confirm

The checked-in 1 October inventory identifies VoIP EC2
`i-0851dd1ea1cfeef71` in `ap-southeast-7a`, historical address
`43.210.122.111`, and container `cp11-postgres`, database `phone11ai`, schema
`public`. This is a historical candidate. Owner confirmation and fresh host,
database and routing observations must precede a target-specific action.
Kamailio's separate RDS connection is outside that local-database inventory.

[Writer inventory](PBX-WRITER-AUDIT-FOLLOWUP-20261001.md) describes both database
paths. [Effective foreign-key requirements](PBX-EFFECTIVE-FOREIGN-KEYS-20261007.md)
record the latest checked-in 6 October observation: public API3023 and nine
advanced PBX tables absent. Old API3016 instructions do not establish the current
release or rollback target.

## Review sequence

1. **Bind the target and current state.** Confirm the intended EC2/local database
   and Kamailio database mappings. Record fresh host/database identity, schema,
   active application and dialplan/configuration hashes, and retained predecessor
   hashes. Use an admitted observer connection for the existing read-only
   schema preflight; the script resolves ambient database configuration and must
   not run against an unspecified environment.
2. **Prove the schema and rollback on a protected clone.** Map each active,
   retained, external and scheduled extension writer to its runtime principal and
   custodian. Choose the prerequisite that matches the observed schema. The
   legacy-default prerequisite and advanced migration commit their own
   transactions; they are not read-only probes. Verify the effective foreign
   keys, cross-tenant rejection, omitted-tenant rejection, all retained writers,
   application rollback and backup restore before preparing production SQL.
   Rollback must not restore the legacy implicit tenant default.
3. **Review one concrete activation packet.** Pin the proposed application,
   schema, routes, dialplan and trusted integration boundaries, the exact current
   prestate, test window, operator, independent reviewer, backup custodian and
   rollback procedure. The owner reviews this complete packet before activation.
   The readiness script validates metadata; it does not grant authority.
4. **Accept actual calls and voicemail.** Use two non-customer tenants with
   distinct test DIDs and nominated signed devices. Exercise IVR digits and
   timeout, ring-group fallback, queue login/overflow, open/closed/holiday routing,
   rejected cross-tenant targets, ringing, answer, two-way audio, hangup and CDR
   correlation. Commission inbox voicemail separately: validate loaded Lua,
   durable deposit/replay, tenant ownership, playback revocation and rollback.

The [two-tenant pilot](NONPRODUCTION-TWO-TENANT-PBX-PILOT-20260916.md),
[rehearsal gates](PBX-RELEASE-GATES-20261001.md) and
[voicemail acceptance packet](VOICEMAIL-ACCEPTANCE-PACKET-20261004.md) supply the
detailed checks. Production voicemail flags remain off until that separate
acceptance is complete.

## Source fixes and release limits

IVR already accepts an explicitly selected workspace. Its home card and sidebar
must therefore be available to an authorized administrator with a selected
workspace and IVR schema capability, including administrators who belong to
multiple workspaces. Existing implicit-workspace restrictions for the other PBX
modules remain unchanged.

The owner confirmed Siprix **trial only**. Internal trial packages do not prove
unrestricted production calling. Signed licensed releases, long-call acceptance
and the deferred physical-phone meeting/push/background checks remain separate
from source tests and commissioning preparation.

No target connection, production schema/routing change, role change, call,
package installation or production cutover was performed for this preparation.
