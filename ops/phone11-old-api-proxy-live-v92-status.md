# Phone11 V92 Old API Host Proxy Status

- Time UTC: 2026-05-27T01:17:53+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 2481d65aa9a558153d0ce32ceaac554b65033054
- Old public API host: 43.209.112.208
- Live backend host: 43.210.122.111
- API hostname: api.phone11.ai
- Old EC2 instance: i-0cc8f248b08c5f2fb
- Result: failure
- Exit code: 50

## Sanitized output
```text
=== Phone11 V92 old public API proxy to live backend ===
Time: 2026-05-27T01:17:36+00:00
Old API host: 43.209.112.208
Live backend host: 43.210.122.111
API hostname: api.phone11.ai
--- Locate old public API EC2 ---
Found old API EC2 instance i-0cc8f248b08c5f2fb in ap-southeast-7b
--- Prepare temporary SSH access ---
{
    "RequestId": "71eb0a73-cc48-48d4-b818-118a196f1605",
    "Success": true
}
--- Prepare remote nginx proxy patch ---
--- Run remote nginx proxy patch on old API EC2 ---
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
--- Preflight: old API host and live backend health ---
ip-10-0-2-252
2026-05-27T01:17:52+00:00
Current old public API health through local resolve:
{"ok":true,"timestamp":1779844672213,"build":"7b0c678eeff3893ce53c964f17a88d76327299ab","service":"phone11-backend"}
Live backend HTTP Host-route health from old API host:
{"ok":true,"timestamp":1779844672222,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
--- Discover existing nginx config and certificates ---
	types_hash_max_size 2048;
	# server_tokens off;

	# server_names_hash_bucket_size 64;
	# server_name_in_redirect off;

	include /etc/nginx/mime.types;
	default_type application/octet-stream;
--
# configuration file /etc/nginx/sites-enabled/phone11ai:
server {
    listen 80;
    server_name phone11.ai 1toall.phone11.ai api.phone11.ai;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
--

server {
    listen 443 ssl http2;
    server_name phone11.ai;

    ssl_certificate /etc/letsencrypt/live/phone11.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phone11.ai/privkey.pem;
--
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
--

server {
    listen 443 ssl http2;
    server_name 1toall.phone11.ai;

    ssl_certificate /etc/letsencrypt/live/phone11.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phone11.ai/privkey.pem;
--
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
--

server {
    listen 443 ssl http2;
    server_name api.phone11.ai;

    ssl_certificate /etc/letsencrypt/live/phone11.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phone11.ai/privkey.pem;
--
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
ERROR: No Let's Encrypt certificate found for api.phone11.ai or phone11.ai on old API host.
```
