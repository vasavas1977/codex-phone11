-- DRAFT ONLY. Requires reviewed tenant_memberships schema. Never run at startup.
CREATE TABLE phone11_meeting_rooms (
 id uuid PRIMARY KEY,
 tenant_id integer NOT NULL REFERENCES tenants(id),
 ended_at timestamptz,
 UNIQUE(id,tenant_id)
);
CREATE TABLE phone11_meeting_members (
 meeting_id uuid NOT NULL,
 tenant_id integer NOT NULL,
 user_id integer NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(meeting_id,user_id),
 FOREIGN KEY(meeting_id,tenant_id) REFERENCES phone11_meeting_rooms(id,tenant_id)
);
