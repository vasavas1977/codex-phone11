# PBX SIP revocation acceptance — 24 September 2026

Changing an extension's assigned user or deleting it must stop the former
assignee from authenticating with an already issued SIP password. The API
source rotates or removes the matching `subscriber` authentication row in the
same database transaction as the extension/account change. That prevents a
newly authenticated REGISTER or INVITE with the old password once the change
commits. It does **not** by itself remove an existing registration contact or
terminate an established call.

The tracked Kamailio configuration uses `usrloc` `db_mode=2`, which caches
contacts in memory, and allows registration expiry up to 3600 seconds. A SQL
change to `subscriber` or `location` is therefore not proof of immediate
contact removal. Kamailio's [usrloc RPC documentation](https://www.kamailio.org/docs/modules/devel/modules/usrloc.html)
provides `ul.lookup location AOR` and `ul.rm location AOR`; the latter removes
an address-of-record and all its contacts. The AOR is `USER@DOMAIN` only when
the **effective running** `usrloc use_domain` setting is 1; with its default
of 0, the AOR is `USER` alone. This workspace contains more than one Kamailio
configuration, so the running image, configuration, RPC socket and AOR format
must be verified before relying on this path.

For an isolated, non-customer test extension:

1. Record the exact tenant, extension ID, SIP username/domain, deployed API
   revision, PBX container/image, and registrar configuration. Confirm that
   the extension and account both belong to that tenant and that the
   subscriber digest matches the account before changing anything. Do not
   print or export SIP passwords, raw contact addresses, or connection strings.
2. While the old device is registered, inspect the running Kamailio
   `use_domain` value and verify the contact exists with a targeted
   `kamcmd ul.lookup location AOR` inside that container. Use `USER` when
   `use_domain=0`, or `USER@DOMAIN` when it is 1. Keep the raw contact result
   on the operator host only. Stop if the exact contact is not found.
3. Reassign or delete through the reviewed Phone11 admin API. Confirm the
   database transaction committed and that the old password fails a fresh
   registration challenge. On reassignment, confirm the new owner's password
   registers and a two-way call works.
4. Purge that **same verified AOR** through the local Kamailio RPC
   (`kamcmd ul.rm location AOR`) and confirm a fresh `ul.lookup` of that
   exact AOR contains no old contact. This RPC is an operator step for now; the API
   service has no access to the Kamailio FIFO, so the portal must not claim
   immediate deregistration. A new owner's contact may need to register again
   if it arrived before the purge.
5. Test an inbound call after the purge: the old device must not ring. Verify
   that the new owner rings after registering, or that a deleted extension
   follows the intended unavailable route. Inspect CDR and audit records
   without storing credentials.

An already established SIP dialog can continue after credential rotation and
contact purge. Ending it requires a separately reviewed call-termination path
and live PBX proof. Do not claim immediate full session revocation from this
source change. Before enabling admin reassignment or deletion for customer
tenants, automate a tenant-scoped registrar purge through a protected
operator channel or define an explicit operational hold with a bounded contact
expiry and tested escalation.
