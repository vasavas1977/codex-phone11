# Phone11 Provisioning Backend Self-Test Status

- Time UTC: 2026-05-17T14:23:40+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 735fbd984cffd6ead674e9905769cecbe706dbfb
- EC2 host: 43.209.112.208
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 provisioning backend self-test ===
--- Locate EC2 ---
Found EC2 instance i-0cc8f248b08c5f2fb in ap-southeast-7b
--- Connect and run server-side tests ---
{
    "RequestId": "4f2587b9-9237-43fb-9f21-71e3887a2bed",
    "Success": true
}
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
--- Runtime containers ---
cp11-backend phone11-backend-public:0ff57cd1eee97768938afdf7235929c1a7bf4762 Up 2 minutes (healthy) 
--- Public and local health ---
{"ok":true,"timestamp":1779027818777,"build":"0ff57cd1eee97768938afdf7235929c1a7bf4762","service":"phone11-backend"}
{"ok":true,"timestamp":1779027818828,"build":"0ff57cd1eee97768938afdf7235929c1a7bf4762","service":"phone11-backend"}
--- Backend env keys, names only ---
DB_HOST=<set>
DB_NAME=<set>
DB_<redacted>
DB_USER=<set>
JWT_<redacted>
SIP_DOMAIN=<set>
--- Database and auth self-test ---
DB env: host=phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com, user=<db-user>, database=phone11ai, ssl=enabled, <redacted>
DB login OK as phone11ai on phone11ai
User 1: openId=isohkTe8bZTKXmGHAvAEfz, email=vasavas1977@gmail.com, role=admin
Extension ready: number=1001, display=Extension 1001, status=active
SIP account: username=1001, domain=sip.phone11.ai, status=active, has<redacted>
Generated temporary server-side session token for user 1: <redacted>
GET /api/auth/me with generated token: 401
auth/me body: {"error":"Not authenticated","user":null}
file:///app/[eval1]:63
  if (!me.ok) throw new Error('Generated-token auth failed on backend');
                    ^

Error: Generated-token auth failed on backend
    at file:///app/[eval1]:63:21
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)

Node.js v22.22.2
ERROR: backend self-test failed with status 1
[OAuth] Initialized with baseURL: 
[WS] WebSocket server initialized on /ws
[api] server listening on port 3000
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[OAuth] Initialized with baseURL: 
[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.
[WS] WebSocket server initialized on /ws
[api] server listening on port 3000
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[Auth] Session payload missing required fields
[Auth] /api/auth/me failed: HttpError: Invalid session cookie
    at ForbiddenError (file:///app/dist/index.mjs:164:31)
    at SDKServer.authenticateRequest (file:///app/dist/index.mjs:347:13)
    at async file:///app/dist/index.mjs:481:20 {
  statusCode: 403
}
```
