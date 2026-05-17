# Phone11 Provisioning Backend Self-Test Status

- Time UTC: 2026-05-17T13:10:02+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 6d80b33ebb9513c595e053983e811b5473d9c0ac
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
    "RequestId": "e57f7548-177d-48de-9cd9-4e8f97790f08",
    "Success": true
}
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
--- Runtime containers ---
cp11-backend phone11-backend-public:0056fe4288e7c07bb47b5ca6524b6d1987f289de Up 4 days (healthy) 
--- Public and local health ---
{"ok":true,"timestamp":1779023400918,"build":"0056fe4288e7c07bb47b5ca6524b6d1987f289de","service":"phone11-backend"}
{"ok":true,"timestamp":1779023401084,"build":"0056fe4288e7c07bb47b5ca6524b6d1987f289de","service":"phone11-backend"}
--- Backend env keys, names only ---
DB_HOST=<set>
DB_NAME=<set>
DB_<redacted>
DB_USER=<set>
JWT_<redacted>
SIP_DOMAIN=<set>
--- Database and auth self-test ---
DB env: host=phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com, user=<db-user>, database=phone11ai, ssl=enabled, <redacted>
/app/node_modules/.pnpm/pg-pool@3.13.0_pg@8.20.0/node_modules/pg-pool/index.js:45
    Error.captureStackTrace(err)
          ^

error: <redacted> authentication failed for user "phone11ai"
    at /app/node_modules/.pnpm/pg-pool@3.13.0_pg@8.20.0/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async file:///app/[eval1]:21:16 {
  length: 105,
  severity: 'FATAL',
  code: '28P01',
  detail: undefined,
  hint: undefined,
  position: undefined,
  internalPosition: undefined,
  internalQuery: undefined,
  where: undefined,
  schema: undefined,
  table: undefined,
  column: undefined,
  dataType: undefined,
  constraint: undefined,
  file: 'auth.c',
  line: '326',
  routine: 'auth_failed'
}

Node.js v22.22.2
ERROR: backend self-test failed with status 1
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
    at async Object.createContext (file:///app/dist/index.mjs:3917:12)
    at async Object.createContext (file:///app/node_modules/.pnpm/@trpc+server@11.7.2_typescript@5.9.3/node_modules/@trpc/server/dist/node-http-Cd7-CwtL.mjs:199:13)
    at async Object.create (file:///app/node_modules/.pnpm/@trpc+server@11.7.2_typescript@5.9.3/node_modules/@trpc/server/dist/resolveResponse-D7zvnoIM.mjs:1902:18)
    at async resolveResponse (file:///app/node_modules/.pnpm/@trpc+server@11.7.2_typescript@5.9.3/node_modules/@trpc/server/dist/resolveResponse-D7zvnoIM.mjs:1928:3)
    at async file:///app/node_modules/.pnpm/@trpc+server@11.7.2_typescript@5.9.3/node_modules/@trpc/server/dist/node-http-Cd7-CwtL.mjs:201:22 {
  code: 'ERR_INVALID_URL',
  input: '/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt'
}
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
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection closed, reconnecting in 5s...
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
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
[ESL] Connection error: connect ECONNREFUSED 127.0.0.1:8021
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
```
