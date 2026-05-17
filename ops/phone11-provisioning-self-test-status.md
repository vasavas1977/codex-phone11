# Phone11 Provisioning Backend Self-Test Status

- Time UTC: 2026-05-17T16:08:31+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: a9904f304c794027e39f30c1feb5c99e08946d2d
- EC2 host: 43.209.112.208
- EC2 instance: i-0cc8f248b08c5f2fb
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 provisioning backend self-test ===
Time: 2026-05-17T16:08:10+00:00
--- Locate EC2 ---
Found EC2 instance i-0cc8f248b08c5f2fb in ap-southeast-7b
--- Prepare temporary SSH access ---
{
    "RequestId": "8eed0665-556f-4cc7-8553-1f29df31db09",
    "Success": true
}
--- Prepare remote live-backend test script ---
--- Run remote live-backend test ---
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
--- Runtime containers ---
cp11-backend phone11-backend-public:7b0c678eeff3893ce53c964f17a88d76327299ab Up 24 minutes (healthy)
--- Public and local health ---
{"ok":true,"timestamp":1779034110240,"build":"7b0c678eeff3893ce53c964f17a88d76327299ab","service":"phone11-backend"}
{"ok":true,"timestamp":1779034110250,"build":"7b0c678eeff3893ce53c964f17a88d76327299ab","service":"phone11-backend"}
--- Backend env keys, names only ---
DB_HOST=<set>
DB_NAME=<set>
DB_<redacted>
DB_USER=<set>
JWT_<redacted>
SIP_DOMAIN=<set>
--- Authenticated provisioning API self-test ---
DB env present: host=phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com, user=phone11ai, database=phone11ai, ssl=enabled, <redacted>
DB auth OK: current_user=phone11ai, database=phone11ai
Pilot user loaded: id=1, email=vasavas1977@gmail.com, role=admin, openId=<set>
auth.me OK: id=1, email=vasavas1977@gmail.com, openId=<set>
file:///app/node_modules/.pnpm/@trpc+client@11.7.2_@trpc+server@11.7.2_typescript@5.9.3__typescript@5.9.3/node_modules/@trpc/client/dist/TRPCClientError-CjKyS10w.mjs:40
		if (isTRPCErrorResponse(cause)) return new TRPCClientError(cause.error.message, (0, import_objectSpread2.default)((0, import_objectSpread2.default)({}, opts), {}, { result: cause }));
		                                       ^

TRPCClientError: null value in column "slug" of relation "tenants" violates not-null constraint
    at TRPCClientError.from (file:///app/node_modules/.pnpm/@trpc+client@11.7.2_@trpc+server@11.7.2_typescript@5.9.3__typescript@5.9.3/node_modules/@trpc/client/dist/TRPCClientError-CjKyS10w.mjs:40:42)
    at file:///app/node_modules/.pnpm/@trpc+client@11.7.2_@trpc+server@11.7.2_typescript@5.9.3__typescript@5.9.3/node_modules/@trpc/client/dist/httpBatchLink-BOe5aCcR.mjs:228:38
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5) {
  cause: undefined,
  shape: {
    message: 'null value in column "slug" of relation "tenants" violates not-null constraint',
    code: -32603,
    data: {
      code: 'INTERNAL_SERVER_ERROR',
      httpStatus: 500,
      path: 'phone.ensurePilotConfig'
    }
  },
  data: {
    code: 'INTERNAL_SERVER_ERROR',
    httpStatus: 500,
    path: 'phone.ensurePilotConfig'
  },
  meta: {
    response: Response {
      [Symbol(state)]: {
        aborted: false,
        rangeRequested: false,
        timingAllowPassed: true,
        requestIncludesCredentials: true,
        type: 'default',
        status: 500,
        timingInfo: {
          startTime: 397.20254,
          redirectStartTime: 0,
          redirectEndTime: 0,
          postRedirectStartTime: 397.20254,
          finalServiceWorkerStartTime: 0,
          finalNetworkResponseStartTime: 453.093968,
          finalNetworkRequestStartTime: 398.108633,
          endTime: 0,
          encodedBodySize: 221,
          decodedBodySize: 221,
          finalConnectionTimingInfo: {
            domainLookupStartTime: 397.20254,
            domainLookupEndTime: 397.20254,
            connectionStartTime: 397.20254,
            connectionEndTime: 397.20254,
            secureConnectionStartTime: 397.20254,
            ALPNNegotiatedProtocol: undefined
          }
        },
        cacheState: '',
        statusText: 'Internal Server Error',
        headersList: HeadersList {
          cookies: null,
          [Symbol(headers map)]: Map(10) {
            'x-powered-by' => [Object],
            'access-control-allow-methods' => [Object],
            'access-control-allow-headers' => [Object],
            'access-control-allow-credentials' => [Object],
            'content-type' => [Object],
            'vary' => [Object],
            'date' => [Object],
            'connection' => [Object],
            'keep-alive' => [Object],
            'transfer-encoding' => [Object]
          },
          [Symbol(headers map sorted)]: null
        },
        urlList: [
          http://127.0.0.1:3000/api/trpc/phone.ensurePilotConfig?batch=1
        ],
        body: {
          stream: ReadableStream {
            [Symbol(kType)]: 'ReadableStream',
            [Symbol(kState)]: [Object: null prototype],
            [Symbol(nodejs.webstream.isClosedPromise)]: [Object],
            [Symbol(nodejs.webstream.controllerErrorFunction)]: [Function (anonymous)]
          },
          source: null,
          length: null
        }
      },
      [Symbol(headers)]: Headers {}
    },
    responseJSON: [
      {
        error: {
          json: {
            message: 'null value in column "slug" of relation "tenants" violates not-null constraint',
            code: -32603,
            data: [Object]
          }
        }
      }
    ]
  }
}

Node.js v22.22.3
ERROR: provisioning backend self-test failed with status 1.
```
