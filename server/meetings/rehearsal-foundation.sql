-- Disposable PostgreSQL rehearsal fixture only. Never apply to a deployed DB.
-- Mirrors the canonical users table in server/db.ts and the tenants,
-- extensions, and user_extensions prerequisites in server/phone-provisioning.ts.
-- The actual owned-auth tables are subsequently created by applyAuthMigration.
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  "openId" VARCHAR(64) NOT NULL,
  name TEXT,
  email VARCHAR(320),
  "loginMethod" VARCHAR(64),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastSignedIn" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX users_openid_unique ON users ("openId");
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL DEFAULT 'Phone11',
  plan VARCHAR(64) NOT NULL DEFAULT 'business',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE extensions (
  id SERIAL PRIMARY KEY,
  org_id INTEGER DEFAULT 1,
  tenant_id INTEGER DEFAULT 1,
  user_id INTEGER,
  extension_number VARCHAR(32) NOT NULL,
  display_name VARCHAR(128),
  type VARCHAR(32) NOT NULL DEFAULT 'user',
  sip_username VARCHAR(64),
  sip_domain VARCHAR(128),
  sip_password VARCHAR(128),
  caller_id_name VARCHAR(128),
  caller_id_number VARCHAR(64),
  transport VARCHAR(16) NOT NULL DEFAULT 'TLS',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  voicemail_enabled BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE user_extensions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  extension_id INTEGER NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, extension_id)
);
