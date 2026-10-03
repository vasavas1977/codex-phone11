-- Schema-only test fixture from the read-only production inventory, 2026-09-13.
-- Contains no production rows or credentials.
CREATE SEQUENCE users_id_seq;
CREATE TABLE users (
 "id" integer NOT NULL DEFAULT nextval('users_id_seq'::regclass),
 "openId" character varying(64) NOT NULL,
 "name" text,
 "email" character varying(320),
 "loginMethod" character varying(64),
 "role" text NOT NULL DEFAULT 'user'::text,
 "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
 "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
 "lastSignedIn" timestamp with time zone NOT NULL DEFAULT now(),
 PRIMARY KEY (id),
 CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])))
);
CREATE SEQUENCE tenants_id_seq;
CREATE TABLE tenants (
 "id" integer NOT NULL DEFAULT nextval('tenants_id_seq'::regclass),
 "name" character varying(128) NOT NULL DEFAULT 'Phone11'::character varying,
 "plan" character varying(64) NOT NULL DEFAULT 'business'::character varying,
 "status" character varying(32) NOT NULL DEFAULT 'active'::character varying,
 "created_at" timestamp with time zone DEFAULT now(),
 "updated_at" timestamp with time zone DEFAULT now(),
 PRIMARY KEY (id)
);
CREATE SEQUENCE extensions_id_seq;
CREATE TABLE extensions (
 "id" integer NOT NULL DEFAULT nextval('extensions_id_seq'::regclass),
 "org_id" integer DEFAULT 1,
 "tenant_id" integer DEFAULT 1,
 "user_id" integer,
 "extension_number" character varying(32) NOT NULL,
 "display_name" character varying(128),
 "type" character varying(32) NOT NULL DEFAULT 'user'::character varying,
 "sip_username" character varying(64),
 "sip_domain" character varying(128),
 "sip_password" character varying(128),
 "caller_id_name" character varying(128),
 "caller_id_number" character varying(64),
 "transport" character varying(16) NOT NULL DEFAULT 'TLS'::character varying,
 "status" character varying(32) NOT NULL DEFAULT 'active'::character varying,
 "voicemail_enabled" boolean NOT NULL DEFAULT false,
 "deleted_at" timestamp with time zone,
 "created_at" timestamp with time zone DEFAULT now(),
 "updated_at" timestamp with time zone DEFAULT now(),
 PRIMARY KEY (id)
);
CREATE SEQUENCE user_extensions_id_seq;
CREATE TABLE user_extensions (
 "id" integer NOT NULL DEFAULT nextval('user_extensions_id_seq'::regclass),
 "user_id" integer NOT NULL,
 "extension_id" integer NOT NULL,
 "is_primary" boolean NOT NULL DEFAULT false,
 "created_at" timestamp with time zone DEFAULT now(),
 FOREIGN KEY (extension_id) REFERENCES extensions(id) ON DELETE CASCADE,
 PRIMARY KEY (id),
 UNIQUE (user_id, extension_id)
);
-- Authentication is outside this fixture; retain its referenced key for wake FKs.
CREATE TABLE phone11_auth_session(id TEXT PRIMARY KEY);
CREATE TABLE phone11_wake_bindings (
 "id" uuid NOT NULL,
 "session_id" text NOT NULL,
 "session_binding" uuid NOT NULL,
 "user_id" integer NOT NULL,
 "tenant_id" integer NOT NULL,
 "extension_id" integer NOT NULL,
 "device_id" character varying(512) NOT NULL,
 "push_revision" uuid NOT NULL,
 "grant_hash" character(64) NOT NULL,
 "expires_at" timestamp with time zone NOT NULL,
 "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (extension_id) REFERENCES extensions(id),
 PRIMARY KEY (id),
 FOREIGN KEY (session_id) REFERENCES phone11_auth_session(id) ON DELETE CASCADE,
 UNIQUE (tenant_id, extension_id),
 FOREIGN KEY (tenant_id) REFERENCES tenants(id),
 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE phone11_wake_calls (
 "id" uuid NOT NULL,
 "binding_id" uuid NOT NULL,
 "sip_call_id" character varying(512) NOT NULL,
 "sip_uri" character varying(512) NOT NULL,
 "state" text NOT NULL,
 "expires_at" timestamp with time zone NOT NULL,
 "busy_until" timestamp with time zone,
 "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (binding_id) REFERENCES phone11_wake_bindings(id) ON DELETE CASCADE,
 UNIQUE (binding_id, sip_call_id),
 PRIMARY KEY (id),
 CHECK ((state = ANY (ARRAY['pending'::text, 'ready'::text, 'cancelled'::text, 'ended'::text])))
);
