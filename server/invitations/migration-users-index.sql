-- Phase 1 of the invitation migration. Run with psql -X -v ON_ERROR_STOP=1 -f.
-- Do not use --single-transaction: CREATE INDEX CONCURRENTLY needs its own transaction.
-- Apply to a backed-up clone and inspect it before running against a live database.
SET lock_timeout = '5s';
SET statement_timeout = '15min';

DO $$ BEGIN
  IF to_regclass('tenants') IS NULL OR to_regclass('users') IS NULL
     OR to_regclass('tenant_memberships') IS NULL
     OR to_regclass('phone11_auth_user') IS NULL
     OR to_regclass('phone11_auth_account') IS NULL
     OR to_regclass('phone11_auth_identity') IS NULL THEN
    RAISE EXCEPTION 'Phone11 invitation prerequisites are missing';
  END IF;
  IF to_regclass('phone11_workspace_invitations') IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation tables already exist; review before reapplying';
  END IF;
  IF to_regclass('phone11_users_normalized_email_unique') IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical email index already exists; inspect validity before continuing';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email IS NOT NULL GROUP BY lower(trim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Ambiguous canonical user emails require manual review';
  END IF;
END $$;

-- Other canonical-user creation paths must obey this index. Concurrent build
-- avoids a long write block on the live users table. It can still fail if a
-- duplicate appears during the build; leave the feature off and inspect the index.
CREATE UNIQUE INDEX CONCURRENTLY phone11_users_normalized_email_unique
  ON users (lower(trim(email))) WHERE email IS NOT NULL;
