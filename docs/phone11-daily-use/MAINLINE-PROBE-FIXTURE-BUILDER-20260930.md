# Phone11 mainline candidate probe fixture builder

Status: source and offline tests only. This operator has not signed in, queried the
host database, created a live fixture, or run release-route prepare. Independent
security/source review is required before operator use.

`scripts/phone11-mainline-fixture-builder.py` creates the one candidate-only
five-GET probe bundle consumed by `phone11-mainline-release-route.py` at the
loopback candidate port pinned in the root-owned release-start manifest. The
builder accepts only isolated candidate ports 3019 and 3020 and only the fixed
host `127.0.0.1`; it refuses other ports. Before any credential prompt, it
validates the root-owned start receipt against the manifest and reuses the
release-start checks for the exact candidate container ID, image, build, role,
health, environment, runtime settings, mounts, labels, and bundle hash. It
repeats this check immediately before sign-in and session verification. It
cannot contact the old 3016 service.
The approved test extensions are `3001` and `1020`, but the operator must enter
the actual canonical user ID, email, role, selected tenant, and distinct denied
tenant from reviewed identity evidence. The tool does not infer these from an
extension number.

Run `--dry-run` first with the intended public, non-secret identity values:

```text
python3 scripts/phone11-mainline-fixture-builder.py --dry-run \
  --output-name candidate-reviewed.json --user-id <reviewed-user-id> \
  --extension 3001 --tenant-id <reviewed-tenant-id> \
  --denied-tenant-id <reviewed-denied-tenant-id> \
  --user-role user --tenant-role user \
  --manifest /root/<reviewed-mainline-start-manifest>.json \
  --start-receipt /var/lib/phone11-mainline-release-start/<candidate-container-id>.json \
  --database-container-id <reviewed-64-character-cp11-postgres-id>
```

Dry run validates arguments and does no network, password prompt, sign-in, or
file write. After independent review and action-time authorization, `--apply`
with the same arguments must run as root in a TTY. It prompts for the approved
test email and a read-only database URL. The URL must name database `phone11ai`
at `127.0.0.1:5432`; remote hosts, DNS names, Unix sockets, and query-string
host overrides are rejected. The exact candidate image comes from the existing
root-owned, strictly parsed mainline start manifest. The identity query runs
in a disposable container from that image, as UID/GID 65534 with a read-only
filesystem, dropped capabilities, no new privileges, no Docker log driver,
and the network namespace of the exact reviewed running `cp11-postgres`
container ID. It has no host networking, additional mounts, or database URL
in argv or environment. The URL crosses only the Docker stdin pipe. The
observed host inventory has `cp11-postgres` published only on loopback
`127.0.0.1:5432`; no live connection was made here. A bounded PostgreSQL read-only
transaction checks the active Better Auth to canonical-user mapping, exact
user ID/email/global and tenant roles, active selected-tenant membership and
assigned extension, and absence of active membership in a real, active denied
tenant. A mismatch stops before prompting for the account password or signing
in. Only then does the operator prompt for the test password, sign in to the
manifest-pinned candidate port, and match the fresh auth user ID and session
to the preflight. It reads no
existing sessions. Passwords, database URL, bearer token, and response bodies
are not printed. The sign-in creates a new test-account session; use only the
two explicitly approved test accounts, never customer or personal credentials.
The repeated inspection narrows the interval in which a trusted root operator
could replace or rebind the candidate, but local Docker state and loopback
cannot be made atomic with the HTTP connection. Run this on a trusted host with
exclusive control of Docker and the candidate port during fixture creation.

`--apply` writes a new file under `/var/lib/phone11-mainline-fixtures` with
root:root ownership, `0700` directory and `0600` file permissions. It refuses
symlinks or an existing filename and prints only the file path and SHA-256.
The file contains a bearer token and must stay root-only. Pin the printed
digest in the separately reviewed release-route invocation. A fresh fixture
is needed when that session expires or is revoked. The builder does not prove
directory, meeting admission, Connect11 scope, provider behavior, deployment,
or device acceptance; those release gates remain separate.
