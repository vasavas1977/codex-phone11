-- =============================================================================
-- CloudPhone11 — PostgreSQL Initialization
-- =============================================================================
-- Creates schemas and tables for Kamailio, FreeSWITCH CDR, and the backend API.
-- Runs once on first container start via docker-entrypoint-initdb.d.
-- =============================================================================

-- Kamailio subscriber table (SIP user authentication)
CREATE TABLE IF NOT EXISTS subscriber (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    domain VARCHAR(64) NOT NULL DEFAULT '',
    password VARCHAR(128) NOT NULL DEFAULT '',
    ha1 VARCHAR(128) NOT NULL DEFAULT '',
    ha1b VARCHAR(128) NOT NULL DEFAULT '',
    email_address VARCHAR(128) NOT NULL DEFAULT '',
    rpid VARCHAR(128) DEFAULT NULL,
    UNIQUE (username, domain)
);

-- Kamailio location table (SIP registrations)
CREATE TABLE IF NOT EXISTS location (
    id SERIAL PRIMARY KEY,
    ruid VARCHAR(64) NOT NULL DEFAULT '',
    username VARCHAR(64) NOT NULL DEFAULT '',
    domain VARCHAR(64) DEFAULT NULL,
    contact VARCHAR(512) NOT NULL DEFAULT '',
    received VARCHAR(128) DEFAULT NULL,
    path VARCHAR(512) DEFAULT NULL,
    expires TIMESTAMP NOT NULL DEFAULT '2030-05-28 21:32:15',
    q REAL NOT NULL DEFAULT 1.0,
    callid VARCHAR(255) NOT NULL DEFAULT 'Default-Call-ID',
    cseq INTEGER NOT NULL DEFAULT 1,
    last_modified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    flags INTEGER NOT NULL DEFAULT 0,
    cflags INTEGER NOT NULL DEFAULT 0,
    user_agent VARCHAR(255) NOT NULL DEFAULT '',
    socket VARCHAR(64) DEFAULT NULL,
    methods INTEGER DEFAULT NULL,
    instance VARCHAR(255) DEFAULT NULL,
    reg_id INTEGER NOT NULL DEFAULT 0,
    server_id INTEGER NOT NULL DEFAULT 0,
    connection_id INTEGER NOT NULL DEFAULT 0,
    keepalive INTEGER NOT NULL DEFAULT 0,
    partition INTEGER NOT NULL DEFAULT 0,
    UNIQUE (ruid)
);
CREATE INDEX IF NOT EXISTS location_account_idx ON location (username, domain, contact);

-- Kamailio dialog table (active call tracking)
CREATE TABLE IF NOT EXISTS dialog (
    id SERIAL PRIMARY KEY,
    hash_entry INTEGER NOT NULL,
    hash_id INTEGER NOT NULL,
    callid VARCHAR(255) NOT NULL,
    from_uri VARCHAR(255) NOT NULL,
    from_tag VARCHAR(128) NOT NULL,
    to_uri VARCHAR(255) NOT NULL,
    to_tag VARCHAR(128) NOT NULL,
    caller_cseq VARCHAR(20) NOT NULL,
    callee_cseq VARCHAR(20) NOT NULL,
    caller_route_set VARCHAR(512) DEFAULT NULL,
    callee_route_set VARCHAR(512) DEFAULT NULL,
    caller_contact VARCHAR(255) NOT NULL,
    callee_contact VARCHAR(255) NOT NULL,
    caller_sock VARCHAR(64) NOT NULL,
    callee_sock VARCHAR(64) NOT NULL,
    state INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    timeout INTEGER NOT NULL DEFAULT 0,
    sflags INTEGER NOT NULL DEFAULT 0,
    iflags INTEGER NOT NULL DEFAULT 0,
    toroute_name VARCHAR(32) DEFAULT NULL,
    req_uri VARCHAR(255) NOT NULL,
    xdata VARCHAR(512) DEFAULT NULL,
    UNIQUE (hash_entry, hash_id)
);

-- Kamailio dispatcher table (FreeSWITCH load balancing)
CREATE TABLE IF NOT EXISTS dispatcher (
    id SERIAL PRIMARY KEY,
    setid INTEGER NOT NULL DEFAULT 0,
    destination VARCHAR(192) NOT NULL DEFAULT '',
    flags INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    attrs VARCHAR(128) NOT NULL DEFAULT '',
    description VARCHAR(64) NOT NULL DEFAULT ''
);

-- Insert default FreeSWITCH dispatcher destination (set 1)
INSERT INTO dispatcher (setid, destination, flags, priority, description)
VALUES (1, 'sip:freeswitch:5060', 0, 0, 'FreeSWITCH Primary')
ON CONFLICT DO NOTHING;

-- Kamailio presence tables (BLF)
CREATE TABLE IF NOT EXISTS presentity (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    domain VARCHAR(64) NOT NULL,
    event VARCHAR(64) NOT NULL,
    etag VARCHAR(128) NOT NULL,
    expires INTEGER NOT NULL,
    received_time INTEGER NOT NULL,
    body TEXT NOT NULL,
    sender VARCHAR(255) NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    ruid VARCHAR(64) DEFAULT NULL,
    UNIQUE (username, domain, event, etag)
);

CREATE TABLE IF NOT EXISTS active_watchers (
    id SERIAL PRIMARY KEY,
    presentity_uri VARCHAR(255) NOT NULL,
    watcher_username VARCHAR(64) NOT NULL,
    watcher_domain VARCHAR(64) NOT NULL,
    to_user VARCHAR(64) NOT NULL,
    to_domain VARCHAR(64) NOT NULL,
    event VARCHAR(64) NOT NULL DEFAULT 'presence',
    event_id VARCHAR(64) DEFAULT NULL,
    to_tag VARCHAR(128) NOT NULL,
    from_tag VARCHAR(128) NOT NULL,
    callid VARCHAR(255) NOT NULL,
    local_cseq INTEGER NOT NULL,
    remote_cseq INTEGER NOT NULL,
    contact VARCHAR(255) NOT NULL,
    record_route TEXT DEFAULT NULL,
    expires INTEGER NOT NULL,
    status INTEGER NOT NULL DEFAULT 2,
    reason VARCHAR(64) DEFAULT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    socket_info VARCHAR(64) NOT NULL,
    local_contact VARCHAR(255) NOT NULL,
    from_user VARCHAR(64) NOT NULL,
    from_domain VARCHAR(64) NOT NULL,
    updated INTEGER NOT NULL,
    updated_winfo INTEGER NOT NULL,
    flags INTEGER NOT NULL DEFAULT 0,
    user_agent VARCHAR(255) DEFAULT '',
    UNIQUE (callid, to_tag, from_tag)
);

-- FreeSWITCH CDR table
CREATE TABLE IF NOT EXISTS cdr (
    id SERIAL PRIMARY KEY,
    caller_id_name VARCHAR(128),
    caller_id_number VARCHAR(128),
    destination_number VARCHAR(128),
    context VARCHAR(128),
    start_stamp TIMESTAMP,
    answer_stamp TIMESTAMP,
    end_stamp TIMESTAMP,
    duration INTEGER,
    billsec INTEGER,
    hangup_cause VARCHAR(128),
    uuid VARCHAR(256),
    bridge_uuid VARCHAR(256),
    read_codec VARCHAR(128),
    write_codec VARCHAR(128),
    sip_hangup_disposition VARCHAR(128),
    recording_path VARCHAR(512),
    accountcode VARCHAR(128),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS cdr_start_stamp_idx ON cdr (start_stamp);
CREATE INDEX IF NOT EXISTS cdr_caller_idx ON cdr (caller_id_number);
CREATE INDEX IF NOT EXISTS cdr_dest_idx ON cdr (destination_number);

-- Grants
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO cloudphone11;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO cloudphone11;
