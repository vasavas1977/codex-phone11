# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T17:54:02+00:00
- Workflow commit: da833c07fb08187f196131362efcb3be77eb264e
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.209.112.208
- Pilot user id: 1
- Result: failure
- Exit code: 51

## Sanitized output
```text
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-2-252
Time: 2026-05-12T17:54:01+00:00
GitHub SHA: da833c07fb08187f196131362efcb3be77eb264e
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
ERROR: no runtime .env file found on EC2.
--- Runtime layout diagnostics ---
Top-level deployment directories:
total 16
drwxr-xr-x  4 root   root   4096 Apr 26 09:45 .
drwxr-xr-x 22 root   root   4096 Apr 26 09:44 ..
drwx--x--x  4 root   root   4096 Apr 26 09:45 containerd
drwxr-xr-x 11 ubuntu ubuntu 4096 May 12 17:49 phone11ai
total 56
drwxr-xr-x 11 ubuntu ubuntu 4096 May 12 17:49 .
drwxr-xr-x  4 root   root   4096 Apr 26 09:45 ..
-rw-rw-r--  1 ubuntu ubuntu  489 Apr 26 11:08 Dockerfile.backend
drwxr-xr-x  2 ubuntu ubuntu 4096 May  3 10:36 ai-recording-cache
drwxrwxr-x 19 ubuntu ubuntu 4096 May  3 06:15 cloudphone11
drwxrwxr-x  2 ubuntu ubuntu 4096 May 12 17:49 codex-phone11-deploy
-rw-------  1 ubuntu ubuntu 3243 May  3 08:52 deploy.pem
-rw-r--r--  1 ubuntu ubuntu   27 Apr 26 09:45 init.log
drwxrwxr-x  2 ubuntu ubuntu 4096 Apr 26 09:38 logos
drwxrwxr-x  3 ubuntu ubuntu 4096 Apr 26 10:50 nginx
drwxrwxr-x  4 ubuntu ubuntu 4096 Apr 26 10:44 phone11ai
drwxr-xr-x  2 ubuntu ubuntu 4096 May  3 13:40 recordings
drwxrwxr-x  2 ubuntu ubuntu 4096 Apr 26 10:50 tls
drwxr-xr-x  2 ubuntu ubuntu 4096 May  3 13:40 voicemail
total 44
drwxr-x--- 8 ubuntu ubuntu 4096 May  2 10:16 .
drwxr-xr-x 3 root   root   4096 Apr 26 09:44 ..
-rw-r--r-- 1 ubuntu ubuntu  220 Mar 31  2024 .bash_logout
-rw-r--r-- 1 ubuntu ubuntu 3771 Mar 31  2024 .bashrc
drwx------ 4 ubuntu ubuntu 4096 Apr 26 11:04 .cache
drwxrwxr-x 3 ubuntu ubuntu 4096 May  2 10:02 .config
drwxrwxr-x 4 ubuntu ubuntu 4096 Apr 26 11:04 .local
drwxrwxr-x 5 ubuntu ubuntu 4096 Apr 26 11:20 .npm
-rw-r--r-- 1 ubuntu ubuntu  807 Mar 31  2024 .profile
drwx------ 2 ubuntu ubuntu 4096 May  3 08:55 .ssh
-rw-r--r-- 1 ubuntu ubuntu    0 Apr 26 10:44 .sudo_as_admin_successful
-rw------- 1 ubuntu ubuntu    0 May  2 10:16 firebase-sa-key.json
drwxrwxr-x 3 ubuntu ubuntu 4096 May  2 10:05 phone11ai
Potential deploy/config files (paths only):
/home/ubuntu/.npm/_npx/7c7555b0b81cc7e0/node_modules/buffer-from/package.json
/home/ubuntu/.npm/_npx/7c7555b0b81cc7e0/node_modules/drizzle-kit/package.json
/home/ubuntu/.npm/_npx/7c7555b0b81cc7e0/node_modules/esbuild/package.json
/home/ubuntu/.npm/_npx/7c7555b0b81cc7e0/node_modules/get-tsconfig/package.json
/home/ubuntu/.npm/_npx/7c7555b0b81cc7e0/node_modules/resolve-pkg-maps/package.json
/home/ubuntu/.npm/_npx/7c7555b0b81cc7e0/node_modules/source-map-support/package.json
/home/ubuntu/.npm/_npx/7c7555b0b81cc7e0/node_modules/source-map/package.json
/home/ubuntu/.npm/_npx/7c7555b0b81cc7e0/node_modules/tsx/package.json
/home/ubuntu/.npm/_npx/7c7555b0b81cc7e0/package.json
/opt/phone11ai/cloudphone11/deploy/billrun/docker-compose.yml
/opt/phone11ai/cloudphone11/deploy/freeswitch/docker-compose.yml
/opt/phone11ai/cloudphone11/deploy/kamailio/docker-compose.yml
/opt/phone11ai/cloudphone11/infra/compose/docker-compose.dev.yml
/opt/phone11ai/cloudphone11/infra/compose/docker-compose.prod.yml
/opt/phone11ai/cloudphone11/package.json
/opt/phone11ai/phone11ai/deploy/backend/<env-file>
/opt/phone11ai/phone11ai/deploy/backend/docker-compose.yml
/opt/phone11ai/phone11ai/deploy/voip/<env-file>
/opt/phone11ai/phone11ai/deploy/voip/docker-compose.yml
Docker containers:
Node and proxy listeners:
LISTEN 0      511          0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=20691,fd=5),("nginx",pid=20690,fd=5),("nginx",pid=20689,fd=5))
LISTEN 0      511          0.0.0.0:443        0.0.0.0:*    users:(("nginx",pid=20691,fd=6),("nginx",pid=20690,fd=6),("nginx",pid=20689,fd=6))
LISTEN 0      511                *:3000             *:*    users:(("node",pid=87980,fd=21))                                                  
PM2 process list:
pm2 command not found
Nginx proxy snippets:

# configuration file /etc/nginx/sites-enabled/phone11ai:
server {
    listen 80;
    server_name phone11.ai 1toall.phone11.ai api.phone11.ai;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
--
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
--
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
--
}

server {
    listen 443 ssl http2;
    server_name api.phone11.ai;

    ssl_certificate /etc/letsencrypt/live/phone11.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phone11.ai/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
```
