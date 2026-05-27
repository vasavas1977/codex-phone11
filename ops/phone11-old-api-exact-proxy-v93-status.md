# Phone11 V93 Exact Old API Proxy Status

- Time UTC: 2026-05-27T01:21:18+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 651eb16e1487c38442a65e0640b39692302a8d2e
- Old public API host: 43.209.112.208
- Live backend host: 43.210.122.111
- API hostname: api.phone11.ai
- Old EC2 instance: i-0cc8f248b08c5f2fb
- Result: success
- Exit code: 0

## Sanitized output
```text
=== Phone11 V93 exact old API nginx proxy patch ===
Old API host: 43.209.112.208
Live backend host: 43.210.122.111
API hostname: api.phone11.ai
Found old API EC2 instance i-0cc8f248b08c5f2fb in ap-southeast-7b
{
    "RequestId": "f9699e57-bcd0-48bc-94dc-158f7ed91e39",
    "Success": true
}
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
--- Preflight health ---
Old API through DNS target before patch:
{"ok":true,"timestamp":1779844875121,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
Live backend from old host:
{"ok":true,"timestamp":1779844875130,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
Nginx config file selected: /etc/nginx/sites-enabled/phone11ai.v93-backup-20260527T011922Z
Backup written: /etc/nginx/sites-enabled/phone11ai.v93-backup-20260527T011922Z.v93-backup-20260527T012115Z
Patched exact api server block to proxy_pass http://43.210.122.111;
--- Patched exact api block preview ---
    server_name api.phone11.ai;

    ssl_certificate /etc/letsencrypt/live/phone11.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phone11.ai/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://43.210.122.111;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host api.phone11.ai;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
--- Validate and reload nginx ---
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "phone11.ai" on 0.0.0.0:80, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "1toall.phone11.ai" on 0.0.0.0:80, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "api.phone11.ai" on 0.0.0.0:80, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "phone11.ai" on 0.0.0.0:80, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "1toall.phone11.ai" on 0.0.0.0:80, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "api.phone11.ai" on 0.0.0.0:80, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "phone11.ai" on 0.0.0.0:443, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "1toall.phone11.ai" on 0.0.0.0:443, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "api.phone11.ai" on 0.0.0.0:443, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "phone11.ai" on 0.0.0.0:443, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "1toall.phone11.ai" on 0.0.0.0:443, ignored
2026/05/27 01:21:15 [warn] 2019825#2019825: conflicting server name "api.phone11.ai" on 0.0.0.0:443, ignored
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
--- Verify old API now returns live backend build ---
{"ok":true,"timestamp":1779844877328,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
{"ok":true,"timestamp":1779844877337,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
V93_EXACT_API_PROXY_TO_LIVE_OK=true build=14055c1e5c77967c65941b674c6a8e7c8e9ab1ff
V93 old exact API host proxy patch succeeded.
```
