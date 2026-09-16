-- Reviewed deployment prerequisite; never executed at application startup.
CREATE TABLE IF NOT EXISTS phone11_conference_rooms (
 id uuid PRIMARY KEY,
 tenant_id integer NOT NULL REFERENCES tenants(id),
 created_by integer NOT NULL,
 provider_room text NOT NULL UNIQUE,
 media_mode text NOT NULL DEFAULT 'audio' CHECK(media_mode IN ('audio','video-mcu')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS phone11_conference_members (
 room_id uuid NOT NULL REFERENCES phone11_conference_rooms(id),
 user_id integer NOT NULL,
 PRIMARY KEY(room_id,user_id)
);
CREATE TABLE IF NOT EXISTS phone11_conference_operations (
 tenant_id integer NOT NULL REFERENCES tenants(id),
 user_id integer NOT NULL,
 idempotency_key text NOT NULL,
 fingerprint text NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','complete')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id,idempotency_key),
 CHECK((state='complete')=(result IS NOT NULL))
);
