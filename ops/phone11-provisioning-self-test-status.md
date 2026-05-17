# Phone11 Provisioning Backend Self-Test Status

- Time UTC: 2026-05-17T14:38:22+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 61a42b634b2d6ccf339819b6d505c7cffbfd58c6
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
    "RequestId": "cd7bf53f-970f-4979-bd2a-c96f0519f703",
    "Success": true
}
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
--- Runtime containers ---
cp11-backend phone11-backend-public:6dc6f130565bacbadadcb84f7b52b7be52f1bd3c Up 2 minutes (healthy) 
--- Public and local health ---
{"ok":true,"timestamp":1779028701095,"build":"6dc6f130565bacbadadcb84f7b52b7be52f1bd3c","service":"phone11-backend"}
{"ok":true,"timestamp":1779028701140,"build":"6dc6f130565bacbadadcb84f7b52b7be52f1bd3c","service":"phone11-backend"}
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
[WS] WebSocket server initialized on /ws
[api] server listening on port 3000
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
[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.
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
[Database] Cannot get user: database not available
[Auth] Failed to sync user from OAuth: TypeError: Invalid URL
    at new URL (node:internal/url:818:25)
    at dispatchHttpRequest (file:///app/node_modules/.pnpm/axios@1.13.2/node_modules/axios/lib/adapters/http.js:408:20)
    at file:///app/node_modules/.pnpm/axios@1.13.2/node_modules/axios/lib/adapters/http.js:249:5
    at new Promise (<anonymous>)
    at wrapAsync (file:///app/node_modules/.pnpm/axios@1.13.2/node_modules/axios/lib/adapters/http.js:229:10)
    at http (file:///app/node_modules/.pnpm/axios@1.13.2/node_modules/axios/lib/adapters/http.js:314:10)
    at Axios.dispatchRequest (file:///app/node_modules/.pnpm/axios@1.13.2/node_modules/axios/lib/core/dispatchRequest.js:51:10)
    at Axios._request (file:///app/node_modules/.pnpm/axios@1.13.2/node_modules/axios/lib/core/Axios.js:185:33)
    at Axios.request (file:///app/node_modules/.pnpm/axios@1.13.2/node_modules/axios/lib/core/Axios.js:40:25)
    at Axios.httpMethod [as post] (file:///app/node_modules/.pnpm/axios@1.13.2/node_modules/axios/lib/core/Axios.js:224:19)
    at Axios.request (file:///app/node_modules/.pnpm/axios@1.13.2/node_modules/axios/lib/core/Axios.js:45:41)
    at async SDKServer.getUserInfoWithJwt (file:///app/dist/index.mjs:323:22)
    at async SDKServer.authenticateRequest (file:///app/dist/index.mjs:354:26)
    at async file:///app/dist/index.mjs:481:20 {
  code: 'ERR_INVALID_URL',
  input: '/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt'
}
[Auth] /api/auth/me failed: HttpError: Failed to sync user info
    at ForbiddenError (file:///app/dist/index.mjs:164:31)
    at SDKServer.authenticateRequest (file:///app/dist/index.mjs:365:15)
    at async file:///app/dist/index.mjs:481:20 {
  statusCode: 403
}
```
