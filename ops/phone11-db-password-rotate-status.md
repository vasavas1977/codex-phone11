# Phone11 DB Password Rotate and Redeploy Status

- Time UTC: 2026-05-17T15:32:25+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: e1d606f438b5a6264034e5be7ae175de7a734119
- EC2 host: 43.209.112.208
- RDS instance: phone11ai-production-postgres
- Runtime DB host: phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com
- Runtime DB region: ap-southeast-7
- Runtime DB name: phone11ai
- Runtime DB user: <db-user>
- Runtime env file: /opt/phone11ai/codex-phone11-deploy/.env
- Result: success
- Exit code: 0

## Sanitized output
```text
=== Phone11 DB <redacted> rotation and backend redeploy ===
Time: 2026-05-17T15:22:30+00:00
--- Locating EC2 instance ---
Found EC2 instance i-0cc8f248b08c5f2fb in ap-southeast-7b
--- Preparing temporary SSH access ---
{
    "RequestId": "0d9b7811-5d10-432b-b5b3-83e26d5edcca",
    "Success": true
}
--- Reading backend DB config from EC2 .env ---
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
Backend DB config loaded from /opt/phone11ai/codex-phone11-deploy/.env
DB host: phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com
DB region: ap-southeast-7
DB name: phone11ai
DB user: <db-user>
--- Finding RDS instance ---
RDS instance: phone11ai-production-postgres
--- Generating new DB <redacted> and rotating RDS ---
::add-mask::<redacted>
Waiting for RDS instance to become available.
RDS <redacted> rotation completed.
--- Preparing EC2 env update helper ---
--- Updating EC2 backend .env files with rotated <redacted> ---
Updated env files: /opt/phone11ai/codex-phone11-deploy/.env, /opt/phone11ai/phone11ai/deploy/backend/.env
--- Cleaning EC2 Docker cache before backend rebuild ---
Disk before cleanup:
Filesystem      Size  Used Avail Use% Mounted on
/dev/root        48G   12G   36G  26% /
/dev/root        48G   12G   36G  26% /
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          5         1         4.689GB   893.5MB (19%)
Containers      1         1         4.096kB   0B (0%)
Local Volumes   0         0         0B        0B
Build Cache     0         0         0B        0B
DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
            Install the buildx component to build images with BuildKit:
            https://docs.docker.com/go/buildx/

Total reclaimed space: 0B
Total reclaimed space: 0B
Deleted Images:
untagged: sha256:4c39c49ee297aae00ed62d519989b3e2aa423d5fcde478cdc8f7c7797a8093ad
deleted: sha256:4c39c49ee297aae00ed62d519989b3e2aa423d5fcde478cdc8f7c7797a8093ad
untagged: sha256:61e46e11b51045c588b1c3b2ae3fd3f63f96b7f183fafc5497d0252786031302
deleted: sha256:61e46e11b51045c588b1c3b2ae3fd3f63f96b7f183fafc5497d0252786031302
untagged: sha256:8f93fc0f622e93c0505bf32c4ff5ee081f7e93168021b4d587fd56437cc5e212
deleted: sha256:8f93fc0f622e93c0505bf32c4ff5ee081f7e93168021b4d587fd56437cc5e212
untagged: sha256:50f1032aa8a30d36fe9ed35c3b2dffaafbb51cb8507984acf10d02565c951f81
deleted: sha256:50f1032aa8a30d36fe9ed35c3b2dffaafbb51cb8507984acf10d02565c951f81
untagged: sha256:db2530530703d647027997a52623c3526a902e993a1f9e6d5a85556c146638eb
deleted: sha256:db2530530703d647027997a52623c3526a902e993a1f9e6d5a85556c146638eb
untagged: sha256:18355912fc09c03dcf853f98c8bfba04a7c7dc71f13dc22958e5fb99e00b7bcc
deleted: sha256:18355912fc09c03dcf853f98c8bfba04a7c7dc71f13dc22958e5fb99e00b7bcc
untagged: sha256:3301a187b933f18af38f9a0a1d634d30d3f459396c3ce4e74dbd7f6abed7b925
deleted: sha256:3301a187b933f18af38f9a0a1d634d30d3f459396c3ce4e74dbd7f6abed7b925
untagged: sha256:76d4bd09180a0ccac01ab38ac274616d5869c5151afdef7e22b52f4ff6a33b49
deleted: sha256:76d4bd09180a0ccac01ab38ac274616d5869c5151afdef7e22b52f4ff6a33b49
untagged: sha256:9da51d93141d8af41cb65399657ab75df415b313ac38188fe85882f50977dcbb
deleted: sha256:9da51d93141d8af41cb65399657ab75df415b313ac38188fe85882f50977dcbb
untagged: sha256:fd4de88aa167c07d6eff95ccd970b42545d035b1163721eae10f2f7a88d6f148
deleted: sha256:fd4de88aa167c07d6eff95ccd970b42545d035b1163721eae10f2f7a88d6f148
untagged: sha256:4693a29ac499921d201f8d79fce3da4a1054b92f23347c38fa413badcf71c5a5
deleted: sha256:4693a29ac499921d201f8d79fce3da4a1054b92f23347c38fa413badcf71c5a5
untagged: sha256:76ab073183ae9bf61361f5a326231b8540fc5333fedb49c59a52ec9ca258891b
deleted: sha256:76ab073183ae9bf61361f5a326231b8540fc5333fedb49c59a52ec9ca258891b
untagged: sha256:122c5cae1e45a5494408a87d0ff90a23fd3b6facc7445fb32bd8ed07eeb1e9d0
deleted: sha256:122c5cae1e45a5494408a87d0ff90a23fd3b6facc7445fb32bd8ed07eeb1e9d0
untagged: sha256:3d7a51c9ed198e74f3dc061ccb46a2fdc29f0c07a82a2295ee8fc9b1ddb89ddc
deleted: sha256:3d7a51c9ed198e74f3dc061ccb46a2fdc29f0c07a82a2295ee8fc9b1ddb89ddc
untagged: sha256:aaed7485311738dcbfaa0bfef9e3604358c490938ead7d37e3f72b6c3eb0d33a
deleted: sha256:aaed7485311738dcbfaa0bfef9e3604358c490938ead7d37e3f72b6c3eb0d33a
untagged: sha256:1da5de4a92115dcf29a99130fcbb104849339da4029457593b2d326d69e05be6
deleted: sha256:1da5de4a92115dcf29a99130fcbb104849339da4029457593b2d326d69e05be6
untagged: sha256:7d7e162e997565ec2b8337d4f0604c4bbbd87d16954c8072e0fe567ca187bc96
deleted: sha256:7d7e162e997565ec2b8337d4f0604c4bbbd87d16954c8072e0fe567ca187bc96
untagged: sha256:9cda04b0b6a55f0ee969e6fc3a32196107f2c508e743a8b068edbabf285edc17
deleted: sha256:9cda04b0b6a55f0ee969e6fc3a32196107f2c508e743a8b068edbabf285edc17
untagged: sha256:c14f27a1675fbdb1ec0ac2c66cfade0cf0f95737c5a15bc73d834ac2a56bf265
deleted: sha256:c14f27a1675fbdb1ec0ac2c66cfade0cf0f95737c5a15bc73d834ac2a56bf265
untagged: sha256:17a2fbe10e44853984859a7120ae7171f1147241b9f509e12137cf39e2a7df6a
deleted: sha256:17a2fbe10e44853984859a7120ae7171f1147241b9f509e12137cf39e2a7df6a
untagged: sha256:265f54a4cc3d79e0ce3286c80af5fcc871c0159fac75d2dfa8860bd5c728bd2d
deleted: sha256:265f54a4cc3d79e0ce3286c80af5fcc871c0159fac75d2dfa8860bd5c728bd2d
untagged: sha256:3c20de5ab1862740972a2076ae0aa662d6eae998d544ff42f103d95f88fbc24c
deleted: sha256:3c20de5ab1862740972a2076ae0aa662d6eae998d544ff42f103d95f88fbc24c
untagged: sha256:93f2c8a8d101a3273122afa81457419be9e6a548cf45b4637ccc72fd274acdbf
deleted: sha256:93f2c8a8d101a3273122afa81457419be9e6a548cf45b4637ccc72fd274acdbf
untagged: node:22-alpine
deleted: sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
deleted: sha256:757ec364de4d37cedf30871be2988927660834e656e9aa52aad9ac194814c30c
deleted: sha256:bfaaa13062d14b2f966de80d367e30367abd5c155d443653fc4cfb8d8d01e31a
untagged: sha256:212f67c565932057d81ae22b20bff953ef46ddece9a4b98830a479de92eb4684
deleted: sha256:212f67c565932057d81ae22b20bff953ef46ddece9a4b98830a479de92eb4684
untagged: sha256:2e31e0472e4e72a94473f5786cc88b434bd91d34a2b9437dde71822a58ee28b5
deleted: sha256:2e31e0472e4e72a94473f5786cc88b434bd91d34a2b9437dde71822a58ee28b5
untagged: sha256:2f02d520af7311459e855f538fa62848ad49230da301f07d4600986f442eaa86
deleted: sha256:2f02d520af7311459e855f538fa62848ad49230da301f07d4600986f442eaa86
untagged: sha256:5862215878906fccdd9d7e34607a162dc23b8659ab9f9ded46856b4a22344ded
deleted: sha256:5862215878906fccdd9d7e34607a162dc23b8659ab9f9ded46856b4a22344ded
untagged: sha256:601871574bb11a7e6ee8549f865550a1bbc0813843b8b1d1ea9dcb31724b889d
deleted: sha256:601871574bb11a7e6ee8549f865550a1bbc0813843b8b1d1ea9dcb31724b889d

Total reclaimed space: 776.9MB
Total reclaimed space: 0B
Vacuuming done, freed 0B of archived journals from /var/log/journal/ec20fbfc8f0cc8e2e1ccfe9e56334634.
Vacuuming done, freed 0B of archived journals from /var/log/journal.
Vacuuming done, freed 0B of archived journals from /run/log/journal.
Disk after cleanup:
Filesystem      Size  Used Avail Use% Mounted on
/dev/root        48G  8.7G   39G  19% /
/dev/root        48G  8.7G   39G  19% /
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          1         1         1.123GB   1.123GB (100%)
Containers      1         1         4.096kB   0B (0%)
Local Volumes   0         0         0B        0B
Build Cache     0         0         0B        0B
--- Redeploying backend and verifying pilot extension ---
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-2-252
Time: 2026-05-17T15:24:50+00:00
GitHub SHA: e1d606f438b5a6264034e5be7ae175de7a734119
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
Runtime env keys:
DB_HOST
DB_NAME
DB_<<redacted>
DB_USER
FCM_API_<<redacted>
FS_ESL_<<redacted>
JWT_<<redacted>
REDIS_HOST
SIP_DOMAIN
STORAGE_BUCKET
VOIP_SERVER_IP
From https://github.com/vasavas1977/codex-phone11
 * branch            e1d606f438b5a6264034e5be7ae175de7a734119 -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  eab63ad Clean Docker before Phone11 backend redeploy

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> eab63ad

HEAD is now at e1d606f Trigger Phone11 backend redeploy after Docker cleanup patch
--- Deploying standalone public API backend container ---
DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
            Install the buildx component to build images with BuildKit:
            https://docs.docker.com/go/buildx/

Sending build context to Docker daemon  24.95MB
Step 1/39 : FROM node:22-alpine AS deps
22-alpine: Pulling from library/node
3e7ca773cb61: Download complete
32e2c9b279ac: Download complete
Digest: sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
Status: Downloaded newer image for node:22-alpine
 ---> 968df39aedce
Step 2/39 : WORKDIR /app
 ---> Running in 83bd846a181a
 ---> Removed intermediate container 83bd846a181a
 ---> 6bdf93434dac
Step 3/39 : RUN apk add --no-cache bash curl ca-certificates
 ---> Running in fe2cad793196
( 1/14) Installing ncurses-terminfo-base (6.5_p20251123-r0)
( 2/14) Installing libncursesw (6.5_p20251123-r0)
( 3/14) Installing readline (8.3.1-r0)
( 4/14) Installing bash (5.3.3-r1)
  Executing bash-5.3.3-r1.post-install
( 5/14) Installing ca-certificates (20260413-r0)
( 6/14) Installing brotli-libs (1.2.0-r0)
( 7/14) Installing c-ares (1.34.6-r0)
( 8/14) Installing libunistring (1.4.1-r0)
( 9/14) Installing libidn2 (2.3.8-r0)
(10/14) Installing nghttp2-libs (1.69.0-r0)
(11/14) Installing libpsl (0.21.5-r3)
(12/14) Installing zstd-libs (1.5.7-r2)
(13/14) Installing libcurl (8.19.0-r0)
(14/14) Installing curl (8.19.0-r0)
Executing busybox-1.37.0-r30.trigger
Executing ca-certificates-20260413-r0.trigger
OK: 18.2 MiB in 32 packages
 ---> Removed intermediate container fe2cad793196
 ---> 9f4d1fdb165e
Step 4/39 : RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
 ---> Running in 1567f77815b7
Preparing pnpm@9.12.0 for immediate activation...
 ---> Removed intermediate container 1567f77815b7
 ---> ddf7d6cfff54
Step 5/39 : COPY package.json pnpm-lock.yaml ./
 ---> 1f1c337b5236
Step 6/39 : COPY scripts/ ./scripts/
 ---> 64d1b1e60cde
Step 7/39 : RUN pnpm install --frozen-lockfile --prod
 ---> Running in 9c9abe5023e4
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +899
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

   ╭──────────────────────────────────────────────────────────────────╮
   │                                                                  │
   │                Update available! 9.12.0 → 11.1.2.                │
   │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.1.2   │
   │         Run "corepack install -g pnpm@11.1.2" to update.         │
   │                                                                  │
   │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
   │                                                                  │
   ╰──────────────────────────────────────────────────────────────────╯

Progress: resolved 899, reused 0, downloaded 20, added 8
Progress: resolved 899, reused 0, downloaded 103, added 100
Progress: resolved 899, reused 0, downloaded 239, added 229
Progress: resolved 899, reused 0, downloaded 366, added 359
Progress: resolved 899, reused 0, downloaded 367, added 360
Progress: resolved 899, reused 0, downloaded 448, added 447
Progress: resolved 899, reused 0, downloaded 515, added 512
Progress: resolved 899, reused 0, downloaded 592, added 592
Progress: resolved 899, reused 0, downloaded 653, added 643
Progress: resolved 899, reused 0, downloaded 701, added 688
Progress: resolved 899, reused 0, downloaded 780, added 770
Progress: resolved 899, reused 0, downloaded 842, added 830
Progress: resolved 899, reused 0, downloaded 899, added 899, done
.../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
.../node_modules/react-native-pjsip postinstall$ bash libs.sh
.../node_modules/react-native-pjsip postinstall:   % Total    % Received % Xferd  Average Speed  Time    Time    Time   Current
.../node_modules/react-native-pjsip postinstall:                                  Dload  Upload  Total   Spent   Left   Speed
.../esbuild@0.27.2/node_modules/esbuild postinstall: Done
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 112.2M      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 112.1M      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 112.1M      0                              0
.../node_modules/react-native-pjsip postinstall: ./
.../node_modules/react-native-pjsip postinstall: ./ios/
.../node_modules/react-native-pjsip postinstall: ./android/
.../node_modules/react-native-pjsip postinstall: ./android/src/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libopenh264.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libpjsua2.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libopenh264.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libpjsua2.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libopenh264.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libpjsua2.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libopenh264.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libpjsua2.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCameraInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCamera.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentObject.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnSelectAccountParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTransaction.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_name_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IpChangeParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ipv6_use.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingSubscribeParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtp.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjrpid_activity.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_log_decoration.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/WindowHandle.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamCreatedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_flags_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_packing.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_event_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_destroy_flag.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxData.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_event_id_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_stun_use.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_cap.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_cred_data_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendTypingIndicationParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_status_code.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_use.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSendRequestParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_media_status.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRxOfferParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamStat.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayer.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDesc.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallOpParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pjmedia_vid_dev_hwnd_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_unsigned_char.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_sip_timer_use.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnBuddyEvSubStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfoVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JsonDocument.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SrtpCrypto.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfoVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SdpSession.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_bool_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountIpChangeConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfoVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_dialog_cap_status.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipRxData.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidDevManager.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_mode.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LossType.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_vid_strm_op.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_p_void.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RegProgressParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_dir.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountRegConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_vid_req_keyframe_method.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayerInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/FindBuddyMatch.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_verify_flag_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRedirectedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtpVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMwiConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/EpConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxOption.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_wmm_prio.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ip_change_op.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UaConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFmtChangedEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_id.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaTransportInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaEventParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxMsgEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tp_proto.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountPresConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTsxStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageStatusParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PendingJob.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_flag.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_params.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2Constants.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_format_id.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_turn_tp_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPart.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEventSrc.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_invalid_id_const_.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Media.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnDtmfDigitParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountCallConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMediaConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowHandle.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentDocument.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogEntry.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportSrtpParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresenceStatus.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaRecorder.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_desc.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountNatConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_evsub_state.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfoVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfoVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTxOfferParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindow.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeaderVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimeVal.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Account.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_ssize_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneGenerator.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendInstantMessageParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaCoordinate.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplacedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTransportStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit_map.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_crypto_option.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RxMsgEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Call.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapDigit.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallSdpCreatedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxErrorEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallVidSetStreamParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ConfPortInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_file_access.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_player_option.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEventBody.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamDestroyedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_nat64_opt.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_id.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidCodecParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpSdes.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTimerParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_tsx_state_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_redirect_op.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMedia.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_role_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeader.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStat.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_hold_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_std_index.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_sock_proto.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingCallParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTypingIndicationParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_stream_rc_method.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudDevManager.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Endpoint.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_writer_option.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIpChangeProgressParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_state.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPartVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreview.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferStatusParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_orient.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_flag.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_stun_nat_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaSize.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVideo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MathStat.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_create_media_transport_flag.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStartedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountSipConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresNotifyParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMediaType.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplaceRequestParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_ssl_method.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cipher.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreviewOpParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertName.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UserEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamSetting.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatCheckStunServersCompleteParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_hdr_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatAudio.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_med_tp_st.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigit.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_type_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_inv_state.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnMwiInfoParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Buddy.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStreamStat.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimerEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JbufState.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IntVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_route.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormat.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogWriter.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Error.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_100rel_use.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ContainerNode.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_buddy_status.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2JNI.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_std__vectorT_pj__MediaFormat_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_state.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoSwitchParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSetting.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Version.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SslCertName_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_void.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_constants_.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferRequestParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaTransportStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StringVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_cap.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SrtpCrypto_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEventData.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountVideoConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatDetectionCompleteParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDescVector.java
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/VialerPJSIP
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_simple.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/ZsrtpCWrapper.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/transport_zrtp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_videodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_auth.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_audiodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib++.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_ua.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketGoClear.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheFile.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCodes.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHello.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Decode.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStateClass.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketBase.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecord.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPing.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallback.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheDb.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallbackWrapper.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Encode.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHelloAck.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZRtp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpCacheDbBackend.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpTextData.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/Base32.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConf2Ack.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordDb.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketError.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCWrapper.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpSdesStream.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpPacket.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketSASrelay.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpUserCallback.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketClearAck.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStates.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpConfigure.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCache.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketRelayAck.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConfirm.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCrc32.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketDHPart.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordFile.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketErrorAck.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPingAck.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/EmojiBase32.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketCommit.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/json.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/persistent.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/doxygen.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/config.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/siptypes.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/account.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/endpoint.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/call.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/presence.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/media.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/types.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem2.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl3.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ossl_typ.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dtls1.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/err.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bn.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/blowfish.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cms.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/engine.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf_api.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1_mac.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_x86_64.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/kssl.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7s.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/sha.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/symhacks.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_i386.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bio.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc2.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dh.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui_compat.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509v3.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl23.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md5.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509_vfy.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/txt_db.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/safestack.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdsa.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/objects.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs12.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/crypto.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslv.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs7.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/obj_mac.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/buffer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/camellia.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_arm64.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/evp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/e_os2.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md4.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/hmac.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/aes.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/comp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cast.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc4.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/stack.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ocsp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ec.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdh.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rand.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ts.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pqueue.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dso.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/seed.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/modes.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl2.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rsa.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/krb5_asn.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des_old.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ripemd.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/whrlpool.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/tls1.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/mdc2.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dsa.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srtp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1t.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cmac.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ebcdic.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/idea.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/lhash.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/hash.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/lock.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/proactor.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/file.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/list.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/pool.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/timer.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/string.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/tree.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/scanner.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/types.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/os.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/sock.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/presence.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/iscomposing.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/rpid.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/pidf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/mwi.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/publish.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/xpidf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub_msg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_msg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_sock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_session.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/nat_detect.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_strans.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_session.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_sock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_session.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_transaction.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_auth.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opencore_amr.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opus.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_sdp_match.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ffmpeg_vid_codecs.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/speex.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/passthrough.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h.in
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/silk.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ilbc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/gsm.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221_sdp_match.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g722.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/bcg729.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h264_packetizer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h263_packetizer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_helper.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/audio_codecs.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ipp_codecs.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/l16.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/vid_toolbox.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/openh264.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_console.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_bitwise.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/http_client.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/base64.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_imp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/md5.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns_server.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_md5.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/getopt.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_uint.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/xml.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/json.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/resolver.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_sha1.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_telnet.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/srv_resolver.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/pcap.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/sha1.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/stun_simple.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/crc32.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/string.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_ver.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_def.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_api.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_app_def.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_100rel.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_inv.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_xfer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_regc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_replaces.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_timer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/opengl_dev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev_imp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/avi_dev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev_imp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiotest.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_module.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_tel_uri.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_event.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_util.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tcp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_loop.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_msg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_private.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_endpoint.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tls.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_multipart.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_parser.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h.in
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_msg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_uri.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_ua_layer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transaction.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_udp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/print_util.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_dialog.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_parser.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_aka.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_resolve.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua_internal.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_multistream.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_defines.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/circbuf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/conference.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/resample.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/endpoint.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_playlist.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/bidirectional.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_tee.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/symbian_sound_aps.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_srtp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/delaybuf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stereo.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h.in
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp_xr.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/event.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/tonegen.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/videodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi_stream.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/null_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/audiodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/silencedet.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/frame.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_loop.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/converter.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wsola.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/alaw_ulaw.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp_neg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/codec.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/session.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/signatures.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/splitcomb.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec_util.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_ice.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_stream.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/plc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream_common.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/g711.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wave.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/doxygen.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/format.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/jbuf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/clock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_adapter_sample.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/master_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/mem_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_udp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ip_helper.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_io.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ssl_sock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_select.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/limits.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site_sample.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/lock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/os.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/guid.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/fifobuf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_i.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list_i.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/except.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_access.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/timer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/unicode.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rbtree.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/activesock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/log.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ctype.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_qos.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/array.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string_i.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rand.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/addr_resolv.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/math.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ioqueue.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/doxygen.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/assert.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/hash.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_alt.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_buf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/time.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_sunos.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_m68k.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/malloc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_msvc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_armv4.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux_kernel.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/limits.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32_wince.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_armcc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_powerpc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_rtems.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/high_precision.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_codew.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcce.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_x86_64.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h.in
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/setjmp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_darwinos.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winuwp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdfileio.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_alpha.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/ctype.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_mwcc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_symbian.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/rand.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdarg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/size_t.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h.in
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_i386.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/assert.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/socket.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winphone8.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_palmos.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/string.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_sparc.h
.../node_modules/react-native-pjsip postinstall: Done

dependencies:
+ @expo/vector-icons 15.0.3
+ @react-native-async-storage/async-storage 2.2.0
+ @react-navigation/bottom-tabs 7.8.12
+ @react-navigation/elements 2.9.2
+ @react-navigation/native 7.1.25
+ @tanstack/react-query 5.90.12
+ @trpc/client 11.7.2
+ @trpc/react-query 11.7.2
+ @trpc/server 11.7.2
+ @types/pg 8.20.0
+ axios 1.13.2
+ clsx 2.1.1
+ cookie 1.1.1
+ dotenv 16.6.1
+ drizzle-orm 0.44.7
+ expo 54.0.29
+ expo-audio 1.1.0
+ expo-build-properties 1.0.10
+ expo-constants 18.0.12
+ expo-dev-client 6.0.21
+ expo-font 14.0.10
+ expo-haptics 15.0.8
+ expo-image 3.0.11
+ expo-keep-awake 15.0.8
+ expo-linking 8.0.10
+ expo-notifications 0.32.15
+ expo-router 6.0.19
+ expo-secure-store 15.0.8
+ expo-splash-screen 31.0.12
+ expo-status-bar 3.0.9
+ expo-symbols 1.0.8
+ expo-system-ui 6.0.9
+ expo-video 3.0.15
+ expo-web-browser 15.0.10
+ express 4.22.1
+ google-auth-library 10.6.2
+ ioredis 5.10.1
+ jose 6.1.0
+ mysql2 3.16.0
+ nativewind 4.2.1
+ pg 8.20.0
+ react 19.1.0
+ react-dom 19.1.0
+ react-native 0.81.5
+ react-native-callkeep 4.3.16
+ react-native-gesture-handler 2.28.0
+ react-native-pjsip 2.7.4
+ react-native-reanimated 4.1.6
+ react-native-safe-area-context 5.6.2
+ react-native-screens 4.16.0
+ react-native-svg 15.12.1
+ react-native-web 0.21.2
+ react-native-worklets 0.5.1
+ superjson 1.13.3
+ tailwind-merge 2.6.0
+ zod 4.2.1
+ zustand 5.0.12

devDependencies: skipped


> phone11-mobile@1.0.0 postinstall /app
> node scripts/patch-react-native-pjsip.mjs

[phone11-pjsip-patch] Patched react-native-pjsip Android Gradle/source config.
Done in 18.5s
 ---> Removed intermediate container 9c9abe5023e4
 ---> 35ac586549c9
Step 8/39 : RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
 ---> Running in 38e1f30ef307
 ---> Removed intermediate container 38e1f30ef307
 ---> 3cddd08a055d
Step 9/39 : FROM node:22-alpine AS builder
 ---> 968df39aedce
Step 10/39 : WORKDIR /app
 ---> Running in 213fb9ea3995
 ---> Removed intermediate container 213fb9ea3995
 ---> 376d4efd9c97
Step 11/39 : RUN apk add --no-cache bash curl ca-certificates
 ---> Running in 855c94cf6f36
( 1/14) Installing ncurses-terminfo-base (6.5_p20251123-r0)
( 2/14) Installing libncursesw (6.5_p20251123-r0)
( 3/14) Installing readline (8.3.1-r0)
( 4/14) Installing bash (5.3.3-r1)
  Executing bash-5.3.3-r1.post-install
( 5/14) Installing ca-certificates (20260413-r0)
( 6/14) Installing brotli-libs (1.2.0-r0)
( 7/14) Installing c-ares (1.34.6-r0)
( 8/14) Installing libunistring (1.4.1-r0)
( 9/14) Installing libidn2 (2.3.8-r0)
(10/14) Installing nghttp2-libs (1.69.0-r0)
(11/14) Installing libpsl (0.21.5-r3)
(12/14) Installing zstd-libs (1.5.7-r2)
(13/14) Installing libcurl (8.19.0-r0)
(14/14) Installing curl (8.19.0-r0)
Executing busybox-1.37.0-r30.trigger
Executing ca-certificates-20260413-r0.trigger
OK: 18.2 MiB in 32 packages
 ---> Removed intermediate container 855c94cf6f36
 ---> 963751c7cdc9
Step 12/39 : RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
 ---> Running in dddd6b23671e
Preparing pnpm@9.12.0 for immediate activation...
 ---> Removed intermediate container dddd6b23671e
 ---> 81483419c7e4
Step 13/39 : COPY package.json pnpm-lock.yaml ./
 ---> 89ee746e785e
Step 14/39 : COPY scripts/ ./scripts/
 ---> 469630c35bd9
Step 15/39 : RUN pnpm install --frozen-lockfile
 ---> Running in 72fee3d09974
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +1158
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

   ╭──────────────────────────────────────────────────────────────────╮
   │                                                                  │
   │                Update available! 9.12.0 → 11.1.2.                │
   │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.1.2   │
   │         Run "corepack install -g pnpm@11.1.2" to update.         │
   │                                                                  │
   │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
   │                                                                  │
   ╰──────────────────────────────────────────────────────────────────╯

Progress: resolved 1158, reused 0, downloaded 8, added 0
Progress: resolved 1158, reused 0, downloaded 86, added 85
Progress: resolved 1158, reused 0, downloaded 217, added 207
Progress: resolved 1158, reused 0, downloaded 359, added 354
Progress: resolved 1158, reused 0, downloaded 366, added 359
Progress: resolved 1158, reused 0, downloaded 445, added 445
Progress: resolved 1158, reused 0, downloaded 518, added 509
Progress: resolved 1158, reused 0, downloaded 602, added 601
Progress: resolved 1158, reused 0, downloaded 667, added 653
Progress: resolved 1158, reused 0, downloaded 723, added 713
Progress: resolved 1158, reused 0, downloaded 818, added 804
Progress: resolved 1158, reused 0, downloaded 876, added 875
Progress: resolved 1158, reused 0, downloaded 914, added 900
Progress: resolved 1158, reused 0, downloaded 1027, added 1022
Progress: resolved 1158, reused 0, downloaded 1120, added 1107
Progress: resolved 1158, reused 0, downloaded 1158, added 1158, done
.../node_modules/unrs-resolver postinstall$ napi-postinstall unrs-resolver 1.11.1 check
.../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
.../esbuild@0.18.20/node_modules/esbuild postinstall$ node install.js
.../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
.../esbuild@0.21.5/node_modules/esbuild postinstall$ node install.js
.../node_modules/unrs-resolver postinstall: Done
.../esbuild@0.21.5/node_modules/esbuild postinstall: Done
.../esbuild@0.25.12/node_modules/esbuild postinstall: Done
.../node_modules/react-native-pjsip postinstall$ bash libs.sh
.../esbuild@0.27.2/node_modules/esbuild postinstall: Done
.../esbuild@0.18.20/node_modules/esbuild postinstall: Done
.../node_modules/react-native-pjsip postinstall:   % Total    % Received % Xferd  Average Speed  Time    Time    Time   Current
.../node_modules/react-native-pjsip postinstall:                                  Dload  Upload  Total   Spent   Left   Speed
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 171.7M      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 171.6M      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 171.5M      0                              0
.../node_modules/react-native-pjsip postinstall: ./
.../node_modules/react-native-pjsip postinstall: ./ios/
.../node_modules/react-native-pjsip postinstall: ./android/
.../node_modules/react-native-pjsip postinstall: ./android/src/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libopenh264.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libpjsua2.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libopenh264.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libpjsua2.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libopenh264.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libpjsua2.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libopenh264.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libpjsua2.so
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCameraInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCamera.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentObject.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnSelectAccountParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTransaction.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_name_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IpChangeParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ipv6_use.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingSubscribeParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtp.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjrpid_activity.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_log_decoration.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/WindowHandle.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamCreatedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_flags_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_packing.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_event_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_destroy_flag.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxData.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_event_id_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_stun_use.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_cap.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_cred_data_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendTypingIndicationParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_status_code.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_use.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSendRequestParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_media_status.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRxOfferParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamStat.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayer.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDesc.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallOpParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pjmedia_vid_dev_hwnd_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_unsigned_char.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_sip_timer_use.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnBuddyEvSubStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfoVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JsonDocument.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SrtpCrypto.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfoVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SdpSession.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_bool_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountIpChangeConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfoVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_dialog_cap_status.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipRxData.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidDevManager.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_mode.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LossType.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_vid_strm_op.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_p_void.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RegProgressParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_dir.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountRegConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_vid_req_keyframe_method.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayerInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/FindBuddyMatch.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_verify_flag_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRedirectedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtpVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMwiConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/EpConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxOption.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_wmm_prio.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ip_change_op.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UaConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFmtChangedEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_id.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaTransportInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaEventParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxMsgEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tp_proto.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountPresConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTsxStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageStatusParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PendingJob.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_flag.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_params.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2Constants.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_format_id.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_turn_tp_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPart.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEventSrc.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_invalid_id_const_.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Media.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnDtmfDigitParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountCallConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMediaConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowHandle.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentDocument.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogEntry.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportSrtpParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresenceStatus.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaRecorder.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_desc.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountNatConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_evsub_state.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfoVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfoVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTxOfferParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindow.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeaderVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimeVal.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Account.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_ssize_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneGenerator.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendInstantMessageParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaCoordinate.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplacedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTransportStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit_map.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_crypto_option.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RxMsgEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Call.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapDigit.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallSdpCreatedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxErrorEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallVidSetStreamParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ConfPortInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_file_access.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_player_option.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEventBody.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamDestroyedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_nat64_opt.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_id.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidCodecParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpSdes.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTimerParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_tsx_state_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_redirect_op.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMedia.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_role_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeader.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStat.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_hold_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_std_index.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_sock_proto.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingCallParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTypingIndicationParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_stream_rc_method.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudDevManager.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Endpoint.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_writer_option.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIpChangeProgressParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_state.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPartVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreview.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferStatusParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_orient.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_flag.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_stun_nat_type.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaSize.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVideo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MathStat.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_create_media_transport_flag.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStartedParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountSipConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresNotifyParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMediaType.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplaceRequestParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_ssl_method.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cipher.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreviewOpParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertName.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UserEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamSetting.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatCheckStunServersCompleteParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_hdr_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatAudio.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_med_tp_st.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigit.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_type_e.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_inv_state.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnMwiInfoParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Buddy.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStreamStat.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimerEvent.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JbufState.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IntVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_route.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormat.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogWriter.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Error.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_100rel_use.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ContainerNode.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_buddy_status.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2JNI.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_std__vectorT_pj__MediaFormat_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_state.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoSwitchParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSetting.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Version.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SslCertName_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfo.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_void.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_constants_.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferRequestParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaTransportStateParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StringVector.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_cap.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SrtpCrypto_t.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEventData.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountVideoConfig.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatDetectionCompleteParam.java
.../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDescVector.java
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/VialerPJSIP
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_simple.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/ZsrtpCWrapper.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/transport_zrtp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_videodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_auth.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_audiodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib++.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_ua.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketGoClear.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheFile.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCodes.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHello.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Decode.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStateClass.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketBase.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecord.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPing.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallback.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheDb.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallbackWrapper.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Encode.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHelloAck.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZRtp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpCacheDbBackend.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpTextData.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/Base32.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConf2Ack.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordDb.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketError.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCWrapper.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpSdesStream.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpPacket.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketSASrelay.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpUserCallback.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketClearAck.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStates.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpConfigure.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCache.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketRelayAck.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConfirm.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCrc32.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketDHPart.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordFile.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketErrorAck.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPingAck.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/EmojiBase32.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketCommit.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/json.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/persistent.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/doxygen.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/config.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/siptypes.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/account.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/endpoint.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/call.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/presence.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/media.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/types.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem2.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl3.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ossl_typ.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dtls1.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/err.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bn.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/blowfish.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cms.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/engine.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf_api.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1_mac.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_x86_64.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/kssl.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7s.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/sha.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/symhacks.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_i386.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bio.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc2.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dh.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui_compat.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509v3.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl23.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md5.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509_vfy.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/txt_db.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/safestack.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdsa.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/objects.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs12.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/crypto.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslv.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs7.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/obj_mac.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/buffer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/camellia.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_arm64.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/evp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/e_os2.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md4.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/hmac.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/aes.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/comp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cast.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc4.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/stack.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ocsp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ec.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdh.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rand.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ts.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pqueue.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dso.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/seed.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/modes.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl2.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rsa.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/krb5_asn.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des_old.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ripemd.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/whrlpool.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/tls1.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/mdc2.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dsa.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srtp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1t.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cmac.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ebcdic.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/idea.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/lhash.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/hash.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/lock.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/proactor.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/file.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/list.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/pool.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/timer.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/string.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/tree.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/scanner.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/types.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/os.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/sock.hpp
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/presence.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/iscomposing.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/rpid.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/pidf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/mwi.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/publish.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/xpidf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub_msg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_msg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_sock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_session.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/nat_detect.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_strans.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_session.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_sock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_session.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_transaction.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_auth.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opencore_amr.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opus.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_sdp_match.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ffmpeg_vid_codecs.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/speex.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/passthrough.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h.in
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/silk.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ilbc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/gsm.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221_sdp_match.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g722.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/bcg729.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h264_packetizer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h263_packetizer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_helper.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/audio_codecs.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ipp_codecs.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/l16.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/vid_toolbox.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/openh264.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_console.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_bitwise.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/http_client.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/base64.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_imp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/md5.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns_server.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_md5.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/getopt.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_uint.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/xml.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/json.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/resolver.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_sha1.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_telnet.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/srv_resolver.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/pcap.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/sha1.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/stun_simple.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/crc32.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/string.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_ver.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_def.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_api.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_app_def.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_100rel.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_inv.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_xfer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_regc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_replaces.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_timer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/opengl_dev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev_imp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/avi_dev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev_imp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiotest.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_module.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_tel_uri.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_event.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_util.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tcp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_loop.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_msg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_private.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_endpoint.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tls.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_multipart.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_parser.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h.in
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_msg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_uri.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_ua_layer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transaction.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_udp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/print_util.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_dialog.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_parser.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_aka.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_resolve.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua_internal.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_multistream.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_defines.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/circbuf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/conference.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/resample.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/endpoint.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_playlist.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/bidirectional.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_tee.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/symbian_sound_aps.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_srtp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/delaybuf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stereo.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h.in
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp_xr.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/event.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/tonegen.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/videodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi_stream.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/null_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/audiodev.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/silencedet.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/frame.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_loop.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/converter.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wsola.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/alaw_ulaw.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp_neg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/codec.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/session.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/signatures.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/splitcomb.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec_util.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_ice.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_stream.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/plc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream_common.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/g711.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wave.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/doxygen.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/format.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/jbuf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/clock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_adapter_sample.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/master_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/mem_port.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_udp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ip_helper.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_io.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ssl_sock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_select.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/types.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/limits.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site_sample.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/lock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/os.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/guid.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/fifobuf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_i.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list_i.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/except.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_access.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/timer.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/unicode.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rbtree.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/activesock.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/log.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ctype.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_qos.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/array.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string_i.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rand.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/addr_resolv.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/math.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ioqueue.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/doxygen.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/assert.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/hash.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_alt.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_buf.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/time.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_sunos.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_m68k.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/malloc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_msvc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_armv4.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux_kernel.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/limits.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32_wince.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_armcc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_powerpc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_rtems.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/high_precision.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_codew.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcce.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_x86_64.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h.in
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/setjmp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_darwinos.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winuwp.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdfileio.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_alpha.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/ctype.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_mwcc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_symbian.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/rand.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/errno.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdarg.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/size_t.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h.in
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_i386.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/assert.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcc.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/socket.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winphone8.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_palmos.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/string.h
.../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_sparc.h
.../node_modules/react-native-pjsip postinstall: Done

dependencies:
+ @expo/vector-icons 15.0.3
+ @react-native-async-storage/async-storage 2.2.0
+ @react-navigation/bottom-tabs 7.8.12
+ @react-navigation/elements 2.9.2
+ @react-navigation/native 7.1.25
+ @tanstack/react-query 5.90.12
+ @trpc/client 11.7.2
+ @trpc/react-query 11.7.2
+ @trpc/server 11.7.2
+ @types/pg 8.20.0
+ axios 1.13.2
+ clsx 2.1.1
+ cookie 1.1.1
+ dotenv 16.6.1
+ drizzle-orm 0.44.7
+ expo 54.0.29
+ expo-audio 1.1.0
+ expo-build-properties 1.0.10
+ expo-constants 18.0.12
+ expo-dev-client 6.0.21
+ expo-font 14.0.10
+ expo-haptics 15.0.8
+ expo-image 3.0.11
+ expo-keep-awake 15.0.8
+ expo-linking 8.0.10
+ expo-notifications 0.32.15
+ expo-router 6.0.19
+ expo-secure-store 15.0.8
+ expo-splash-screen 31.0.12
+ expo-status-bar 3.0.9
+ expo-symbols 1.0.8
+ expo-system-ui 6.0.9
+ expo-video 3.0.15
+ expo-web-browser 15.0.10
+ express 4.22.1
+ google-auth-library 10.6.2
+ ioredis 5.10.1
+ jose 6.1.0
+ mysql2 3.16.0
+ nativewind 4.2.1
+ pg 8.20.0
+ react 19.1.0
+ react-dom 19.1.0
+ react-native 0.81.5
+ react-native-callkeep 4.3.16
+ react-native-gesture-handler 2.28.0
+ react-native-pjsip 2.7.4
+ react-native-reanimated 4.1.6
+ react-native-safe-area-context 5.6.2
+ react-native-screens 4.16.0
+ react-native-svg 15.12.1
+ react-native-web 0.21.2
+ react-native-worklets 0.5.1
+ superjson 1.13.3
+ tailwind-merge 2.6.0
+ zod 4.2.1
+ zustand 5.0.12

devDependencies:
+ @config-plugins/react-native-callkeep 12.0.0
+ @expo/ngrok 4.1.3
+ @types/cookie 0.6.0
+ @types/express 4.17.25
+ @types/node 22.19.3
+ @types/qrcode 1.5.6
+ @types/react 19.1.17
+ concurrently 9.2.1
+ cross-env 7.0.3
+ drizzle-kit 0.31.8
+ esbuild 0.25.12
+ eslint 9.39.2
+ eslint-config-expo 10.0.0
+ prettier 3.7.4
+ qrcode 1.5.4
+ tailwindcss 3.4.19
+ tsx 4.21.0
+ typescript 5.9.3
+ vitest 2.1.9


> phone11-mobile@1.0.0 postinstall /app
> node scripts/patch-react-native-pjsip.mjs

[phone11-pjsip-patch] Patched react-native-pjsip Android Gradle/source config.
Done in 21.8s
 ---> Removed intermediate container 72fee3d09974
 ---> c4fc26748e08
Step 16/39 : COPY server/ ./server/
 ---> 84212804f543
Step 17/39 : COPY shared/ ./shared/
 ---> 3e7ff5c95e9e
Step 18/39 : COPY drizzle/ ./drizzle/
 ---> f11e5b20025f
Step 19/39 : COPY drizzle.config.ts ./
 ---> 4414dc6ae811
Step 20/39 : COPY tsconfig.json ./
 ---> c21b4f409896
Step 21/39 : RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
 ---> Running in 1efc29f0a0cb
[91m
  dist/index.mjs  192.3kb

⚡ Done in 27ms
[0m ---> Removed intermediate container 1efc29f0a0cb
 ---> 62a2076da863
Step 22/39 : FROM node:22-alpine AS production
 ---> 968df39aedce
Step 23/39 : LABEL maintainer="CloudPhone11 <ops@cloudphone11.io>"
 ---> Running in b2eec27c0ca5
 ---> Removed intermediate container b2eec27c0ca5
 ---> dd88fc635513
Step 24/39 : LABEL description="CloudPhone11 backend API server"
 ---> Running in be92ce926523
 ---> Removed intermediate container be92ce926523
 ---> bea738b03c17
Step 25/39 : WORKDIR /app
 ---> Running in 5c1224d5f9a7
 ---> Removed intermediate container 5c1224d5f9a7
 ---> 8e9934ea7f8f
Step 26/39 : RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone &&     mkdir -p /var/lib/phone11/recordings /var/lib/phone11/voicemail &&     chown -R cloudphone:cloudphone /var/lib/phone11
 ---> Running in b710782bdc74
 ---> Removed intermediate container b710782bdc74
 ---> 0a879848931a
Step 27/39 : COPY --from=deps /app/node_modules ./node_modules
 ---> 3feb5e5ac8f7
Step 28/39 : COPY --from=builder /app/dist ./dist
 ---> fd20a819cfd0
Step 29/39 : COPY --from=builder /app/drizzle ./drizzle
 ---> 4b1ad4639234
Step 30/39 : COPY package.json ./
 ---> 9445c4caa672
Step 31/39 : ENV NODE_ENV=production
 ---> Running in 57fb1f30d1f0
 ---> Removed intermediate container 57fb1f30d1f0
 ---> 53770a25eb9a
Step 32/39 : ENV PORT=3000
 ---> Running in c6a194074405
 ---> Removed intermediate container c6a194074405
 ---> 9cd6a52f52d3
Step 33/39 : ENV HOST=0.0.0.0
 ---> Running in 63f1757b0fc6
 ---> Removed intermediate container 63f1757b0fc6
 ---> 04016bb41cab
Step 34/39 : ENV RECORDINGS_PATH=/var/lib/phone11/recordings
 ---> Running in 2f5ef5775ffb
 ---> Removed intermediate container 2f5ef5775ffb
 ---> 08863f384f26
Step 35/39 : ENV VOICEMAIL_PATH=/var/lib/phone11/voicemail
 ---> Running in fedd96eeaa46
```
