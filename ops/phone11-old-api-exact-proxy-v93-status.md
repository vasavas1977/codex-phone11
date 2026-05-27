# Phone11 V93 Exact Old API Proxy Status

- Time UTC: 2026-05-27T01:19:25+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: c1329983eda6cc7770a5abe5e97355abe39f3dcb
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
    "RequestId": "2e3d0006-eead-4a5e-903d-f30d016786c2",
    "Success": true
}
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
--- Preflight health ---
Old API through DNS target before patch:
{"ok":true,"timestamp":1779844762896,"build":"7b0c678eeff3893ce53c964f17a88d76327299ab","service":"phone11-backend"}
Live backend from old host:
{"ok":true,"timestamp":1779844762905,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
Nginx config file selected: /etc/nginx/sites-enabled/phone11ai
Backup written: /etc/nginx/sites-enabled/phone11ai.v93-backup-20260527T011922Z
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
--- Verify old API now returns live backend build ---
2026/05/27 01:19:23 [warn] 2018915#2018915: conflicting server name "phone11.ai" on 0.0.0.0:80, ignored
2026/05/27 01:19:23 [warn] 2018915#2018915: conflicting server name "1toall.phone11.ai" on 0.0.0.0:80, ignored
2026/05/27 01:19:23 [warn] 2018915#2018915: conflicting server name "api.phone11.ai" on 0.0.0.0:80, ignored
2026/05/27 01:19:23 [warn] 2018915#2018915: conflicting server name "phone11.ai" on 0.0.0.0:443, ignored
2026/05/27 01:19:23 [warn] 2018915#2018915: conflicting server name "1toall.phone11.ai" on 0.0.0.0:443, ignored
2026/05/27 01:19:23 [warn] 2018915#2018915: conflicting server name "api.phone11.ai" on 0.0.0.0:443, ignored
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
{"ok":true,"timestamp":1779844765084,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
{"ok":true,"timestamp":1779844765093,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
V93_EXACT_API_PROXY_TO_LIVE_OK=true build=14055c1e5c77967c65941b674c6a8e7c8e9ab1ff
V93 old exact API host proxy patch succeeded.
```
