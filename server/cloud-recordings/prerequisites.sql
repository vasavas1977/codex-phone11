-- Additive prerequisites for a database that has authenticated users, tenants,
-- extensions and user_extensions, but no workspace memberships or CDR tables.
-- Deliberately creates no memberships: global user roles are not workspace grants.
-- Run through the reviewed backup/clone migration procedure, never at startup.
BEGIN;
CREATE TABLE IF NOT EXISTS tenant_memberships (
 user_id INTEGER NOT NULL REFERENCES users(id),
 tenant_id INTEGER NOT NULL REFERENCES tenants(id),
 role TEXT NOT NULL CHECK(role IN ('owner','admin','user')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,tenant_id)
);
CREATE TABLE IF NOT EXISTS call_records (
 id SERIAL PRIMARY KEY,
 call_uuid TEXT NOT NULL UNIQUE,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id),
 direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','internal','emergency')),
 from_number TEXT NOT NULL, to_number TEXT NOT NULL,
 caller_user_id INTEGER REFERENCES users(id), callee_user_id INTEGER REFERENCES users(id),
 phone_number_id INTEGER,
 started_at TIMESTAMPTZ NOT NULL, answered_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
 disposition TEXT, total_duration_seconds INTEGER NOT NULL DEFAULT 0,
 total_billable_seconds INTEGER NOT NULL DEFAULT 0, billing_increment INTEGER,
 recording_url TEXT, recording_policy TEXT, voicemail_message_id INTEGER,
 route_type TEXT, route_id INTEGER, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), recording_duration_seconds INTEGER,
 UNIQUE(id,tenant_id)
);
CREATE INDEX IF NOT EXISTS phone11_cdr_tenant_started ON call_records(tenant_id,started_at DESC);
CREATE TABLE IF NOT EXISTS call_legs (
 id SERIAL PRIMARY KEY,
 call_record_id INTEGER NOT NULL,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id),
 leg_uuid TEXT NOT NULL,
 from_uri TEXT, to_uri TEXT,
 caller_user_id INTEGER REFERENCES users(id), callee_user_id INTEGER REFERENCES users(id),
 extension_id INTEGER REFERENCES extensions(id), phone_number_id INTEGER, trunk_id INTEGER,
 started_at TIMESTAMPTZ NOT NULL, ringing_at TIMESTAMPTZ, answered_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
 duration_seconds INTEGER NOT NULL DEFAULT 0, billable_seconds INTEGER NOT NULL DEFAULT 0,
 pdd_ms INTEGER, mos_score NUMERIC, bytes_sent BIGINT, bytes_received BIGINT,
 codec TEXT, codec_read TEXT, codec_write TEXT, hangup_cause TEXT,
 hangup_disposition TEXT, sip_response_code INTEGER, transferred_to TEXT,
 parent_leg_id INTEGER REFERENCES call_legs(id), sip_call_id TEXT,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(call_record_id,tenant_id) REFERENCES call_records(id,tenant_id)
);
-- The current CDR processor inserts repeated leg events, so leg_uuid is indexed
-- but not uniquely constrained. Ownership reconciliation rejects ambiguity.
CREATE INDEX IF NOT EXISTS phone11_cdr_legs_parent ON call_legs(call_record_id,tenant_id);
CREATE INDEX IF NOT EXISTS phone11_cdr_legs_sip ON call_legs(sip_call_id,tenant_id);
CREATE INDEX IF NOT EXISTS phone11_cdr_legs_uuid ON call_legs(leg_uuid);
COMMIT;
