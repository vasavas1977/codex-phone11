-- Apply to a backed-up PostgreSQL clone first. The application never runs this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF to_regclass('tenants') IS NULL OR to_regclass('users') IS NULL
     OR to_regclass('tenant_memberships') IS NULL
     OR to_regclass('phone11_auth_user') IS NULL
     OR to_regclass('phone11_auth_account') IS NULL
     OR to_regclass('phone11_auth_identity') IS NULL THEN
    RAISE EXCEPTION 'Phone11 invitation prerequisites are missing';
  END IF;
  IF to_regclass('phone11_workspace_invitations') IS NOT NULL THEN
    RAISE EXCEPTION 'phone11_workspace_invitations already exists; review before reapplying';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email IS NOT NULL GROUP BY lower(trim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Ambiguous canonical user emails require manual review';
  END IF;
END $$;

-- Other canonical-user creation paths must also obey this database constraint.
CREATE UNIQUE INDEX phone11_users_normalized_email_unique
  ON users (lower(trim(email))) WHERE email IS NOT NULL;

CREATE TABLE phone11_workspace_invitations (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL CHECK (email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
  role TEXT NOT NULL CHECK (role IN ('user','admin')),
  issuer_user_id INTEGER NOT NULL REFERENCES users(id),
  token_digest BYTEA NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  accepted_user_id INTEGER REFERENCES users(id),
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','failed')),
  delivery_error TEXT,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL AND accepted_user_id IS NOT NULL)),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX phone11_workspace_invitations_one_pending_email
  ON phone11_workspace_invitations(tenant_id,email) WHERE status = 'pending';
CREATE INDEX phone11_workspace_invitations_tenant_recent
  ON phone11_workspace_invitations(tenant_id,created_at DESC);
CREATE TABLE phone11_workspace_invitation_events (
  id UUID PRIMARY KEY,
  invitation_id UUID NOT NULL REFERENCES phone11_workspace_invitations(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('created','resent','revoked','accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX phone11_workspace_invitation_events_tenant_recent
  ON phone11_workspace_invitation_events(tenant_id,created_at DESC);
COMMIT;
