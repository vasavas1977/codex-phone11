# Phone11 workspace profile status

`migration.sql` creates tenant-scoped manual availability, status text and work-location preferences. The app does not apply it at startup. Apply it only through the reviewed Phone11 database migration process.

The router authenticates the owner from the session and never accepts a target user ID for writes. Reads require active membership for the caller and each returned colleague. If an older deployment lacks this migration, reads report an unavailable capability and the presence path must continue with its automatic state; writes fail without claiming success.
