# Trigger V90 live backend provisioning proof after V93

Purpose: rerun live backend provisioning proof now that V93 has patched old public api.phone11.ai to proxy to the live backend at 43.210.122.111.

Expected checks:
- Public https://api.phone11.ai/api/health should return live build 14055c1e5c77967c65941b674c6a8e7c8e9ab1ff or newer.
- phone.getConfig for user 1 / extension 1001 should return a SIP password matching the live subscriber password fingerprint.
- The iOS app's stale failed fingerprint 2b847b074c0ba53a should no longer be the provisioned API credential if the fix is complete.

Do not print raw secrets. Only print password length and fingerprint proof.
