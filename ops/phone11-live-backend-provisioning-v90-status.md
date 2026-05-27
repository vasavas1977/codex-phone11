# Phone11 V90 Live Backend Provisioning Status

- Time UTC: 2026-05-27T01:03:31+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 14055c1e5c77967c65941b674c6a8e7c8e9ab1ff
- Live EC2 host: 43.210.122.111
- Live EC2 instance: i-0851dd1ea1cfeef71
- Pilot user id: 1
- Latest app SIP password fingerprint from user log: 2b847b074c0ba53a
- Result: failure
- Exit code: 61

## Sanitized output
```text
=== Phone11 V90 live backend provisioning deploy and evidence ===
Time: 2026-05-27T01:00:18+00:00
Live EC2 host: 43.210.122.111
Expected latest app password fingerprint: 2b847b074c0ba53a
--- Locate live EC2 ---
Found live EC2 instance i-0851dd1ea1cfeef71 in ap-southeast-7a
--- Prepare temporary SSH access ---
{
    "RequestId": "552eaaaf-1183-495d-bfb7-ac08e77f605d",
    "Success": true
}
--- Copy deploy script to live EC2 ---
Warning: Permanently added '43.210.122.111' (ED25519) to the list of known hosts.
--- Redeploy current branch commit to live backend ---
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-27T01:00:33+00:00
GitHub SHA: 14055c1e5c77967c65941b674c6a8e7c8e9ab1ff
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
Runtime env keys:
DB_NAME
DB_<secret-key-redacted>
DB_USER
EXTERNAL_IP
FCM_API_<secret-key-redacted>
FS_ESL_<secret-key-redacted>
JWT_<secret-key-redacted>
PRIVATE_IP
REDIS_<secret-key-redacted>
REDIS_URL
SIP_DOMAIN
STORAGE_BUCKET
From https://github.com/vasavas1977/codex-phone11
 * branch            14055c1e5c77967c65941b674c6a8e7c8e9ab1ff -> FETCH_HEAD
Note: switching to 'FETCH_HEAD'.

You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by switching back to a branch.

If you want to create a new branch to retain commits you create, you may
do so (now or later) by using -c with the switch command. Example:

  git switch -c <new-branch-name>

Or undo this operation with:

  git switch -

Turn off this advice by setting config variable advice.detachedHead to false

HEAD is now at 14055c1 Add live backend provisioning credential evidence workflow
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-27T01:00:34Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 3.25kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 1.5s

#3 [backend internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [backend internal] load build context
#4 transferring context: 11.95kB done
#4 DONE 0.0s

#5 [backend builder  1/13] FROM docker.io/library/node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
#5 resolve docker.io/library/node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 0.0s done
#5 DONE 0.0s

#6 [backend builder  3/13] RUN apk add --no-cache bash curl ca-certificates
#6 CACHED

#7 [backend builder  4/13] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#7 CACHED

#8 [backend builder  2/13] WORKDIR /app
#8 CACHED

#9 [backend builder  5/13] COPY package.json pnpm-lock.yaml ./
#9 CACHED

#10 [backend builder  6/13] COPY scripts/ ./scripts/
#10 DONE 0.1s

#11 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#11 0.966 Lockfile is up to date, resolution step is skipped
#11 1.073 Progress: resolved 1, reused 0, downloaded 0, added 0
#11 1.311 Packages: +899
#11 1.311 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#11 1.550 
#11 1.550    ╭──────────────────────────────────────────────────────────────────╮
#11 1.550    │                                                                  │
#11 1.550    │                Update available! 9.12.0 → 11.3.0.                │
#11 1.550    │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.3.0   │
#11 1.550    │         Run "corepack install -g pnpm@11.3.0" to update.         │
#11 1.550    │                                                                  │
#11 1.550    │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
#11 1.550    │                                                                  │
#11 1.550    ╰──────────────────────────────────────────────────────────────────╯
#11 1.550 
#11 2.097 Progress: resolved 899, reused 0, downloaded 48, added 47
#11 3.098 Progress: resolved 899, reused 0, downloaded 164, added 164
#11 4.099 Progress: resolved 899, reused 0, downloaded 313, added 313
#11 5.100 Progress: resolved 899, reused 0, downloaded 383, added 383
#11 6.102 Progress: resolved 899, reused 0, downloaded 450, added 448
#11 7.102 Progress: resolved 899, reused 0, downloaded 491, added 484
#11 8.102 Progress: resolved 899, reused 0, downloaded 520, added 511
#11 9.103 Progress: resolved 899, reused 0, downloaded 598, added 598
#11 ...

#12 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#12 0.966 Lockfile is up to date, resolution step is skipped
#12 1.127 Progress: resolved 1, reused 0, downloaded 0, added 0
#12 1.444 Packages: +1158
#12 1.444 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#12 1.766 
#12 1.766    ╭──────────────────────────────────────────────────────────────────╮
#12 1.766    │                                                                  │
#12 1.766    │                Update available! 9.12.0 → 11.3.0.                │
#12 1.766    │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.3.0   │
#12 1.766    │         Run "corepack install -g pnpm@11.3.0" to update.         │
#12 1.766    │                                                                  │
#12 1.766    │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
#12 1.766    │                                                                  │
#12 1.766    ╰──────────────────────────────────────────────────────────────────╯
#12 1.766 
#12 2.142 Progress: resolved 1158, reused 0, downloaded 34, added 31
#12 3.143 Progress: resolved 1158, reused 0, downloaded 162, added 161
#12 4.143 Progress: resolved 1158, reused 0, downloaded 312, added 312
#12 5.144 Progress: resolved 1158, reused 0, downloaded 392, added 391
#12 6.148 Progress: resolved 1158, reused 0, downloaded 452, added 446
#12 7.149 Progress: resolved 1158, reused 0, downloaded 495, added 489
#12 8.150 Progress: resolved 1158, reused 0, downloaded 525, added 521
#12 9.151 Progress: resolved 1158, reused 0, downloaded 605, added 605
#12 ...

#11 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#11 10.10 Progress: resolved 899, reused 0, downloaded 674, added 666
#11 11.10 Progress: resolved 899, reused 0, downloaded 729, added 721
#11 12.11 Progress: resolved 899, reused 0, downloaded 802, added 796
#11 13.11 Progress: resolved 899, reused 0, downloaded 850, added 837
#11 13.67 Progress: resolved 899, reused 0, downloaded 899, added 899, done
#11 14.54 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
#11 14.54 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
#11 14.91 .../node_modules/react-native-pjsip postinstall:   % Total    % Received % Xferd  Average Speed  Time    Time    Time   Current
#11 14.91 .../node_modules/react-native-pjsip postinstall:                                  Dload  Upload  Total   Spent   Left   Speed
#11 15.00 .../esbuild@0.27.2/node_modules/esbuild postinstall: Done
#11 15.46 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#11 15.46 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#11 15.46 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#11 16.46 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#11 17.46 .../node_modules/react-native-pjsip postinstall:  11 72.40M  11  8.08M   0      0  5.23M      0   00:13   00:01   00:12  8.09M
#11 ...

#12 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#12 10.15 Progress: resolved 1158, reused 0, downloaded 664, added 655
#12 11.15 Progress: resolved 1158, reused 0, downloaded 732, added 724
#12 12.15 Progress: resolved 1158, reused 0, downloaded 819, added 807
#12 13.16 Progress: resolved 1158, reused 0, downloaded 847, added 841
#12 14.16 Progress: resolved 1158, reused 0, downloaded 899, added 897
#12 15.16 Progress: resolved 1158, reused 0, downloaded 1023, added 1022
#12 16.16 Progress: resolved 1158, reused 0, downloaded 1157, added 1157
#12 16.24 Progress: resolved 1158, reused 0, downloaded 1158, added 1158, done
#12 16.61 .../node_modules/unrs-resolver postinstall$ napi-postinstall unrs-resolver 1.11.1 check
#12 16.61 .../esbuild@0.18.20/node_modules/esbuild postinstall$ node install.js
#12 16.61 .../esbuild@0.21.5/node_modules/esbuild postinstall$ node install.js
#12 16.61 .../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
#12 16.62 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
#12 16.72 .../node_modules/unrs-resolver postinstall: Done
#12 16.72 .../esbuild@0.18.20/node_modules/esbuild postinstall: Done
#12 16.73 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
#12 16.73 .../esbuild@0.21.5/node_modules/esbuild postinstall: Done
#12 16.74 .../node_modules/react-native-pjsip postinstall:   % Total    % Received % Xferd  Average Speed  Time    Time    Time   Current
#12 16.74 .../node_modules/react-native-pjsip postinstall:                                  Dload  Upload  Total   Spent   Left   Speed
#12 16.75 .../esbuild@0.25.12/node_modules/esbuild postinstall: Done
#12 16.77 .../esbuild@0.27.2/node_modules/esbuild postinstall: Done
#12 16.84 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#12 16.84 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#12 16.84 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#12 17.84 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#12 ...

#11 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#11 18.50 .../node_modules/react-native-pjsip postinstall:  41 72.40M  41 30.03M   0      0 11.79M      0   00:06   00:02   00:04 15.01M
#11 19.51 .../node_modules/react-native-pjsip postinstall:  69 72.40M  69 50.01M   0      0 13.93M      0   00:05   00:03   00:02 16.43M
#11 19.95 .../node_modules/react-native-pjsip postinstall:  96 72.40M  96 70.01M   0      0 15.21M      0   00:04   00:04         17.26M
#11 19.95 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 14.37M      0   00:05   00:05         17.26M
#11 19.95 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 14.37M      0   00:05   00:05         17.26M
#11 19.95 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 14.37M      0   00:05   00:05         17.26M
#11 19.96 .../node_modules/react-native-pjsip postinstall: ./
#11 20.36 .../node_modules/react-native-pjsip postinstall: ./ios/
#11 20.36 .../node_modules/react-native-pjsip postinstall: ./android/
#11 20.36 .../node_modules/react-native-pjsip postinstall: ./android/src/
#11 20.36 .../node_modules/react-native-pjsip postinstall: ./android/src/main/
#11 20.36 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/
#11 20.36 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/
#11 20.36 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/
#11 20.36 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/
#11 20.36 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/
#11 20.36 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libopenh264.so
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libpjsua2.so
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libopenh264.so
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libpjsua2.so
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libopenh264.so
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libpjsua2.so
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libopenh264.so
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libpjsua2.so
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCameraInfo.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCamera.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentObject.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnSelectAccountParam.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTransaction.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStateParam.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_name_type.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamInfo.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IpChangeParam.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ipv6_use.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingSubscribeParam.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportParam.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtp.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjrpid_activity.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_log_decoration.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/WindowHandle.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamCreatedParam.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_flags_e.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfo.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_packing.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_event_type.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_destroy_flag.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxData.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_event_id_e.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_stun_use.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_cap.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_cred_data_type.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendTypingIndicationParam.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_status_code.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_use.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSendRequestParam.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_media_status.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRxOfferParam.java
#11 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamStat.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayer.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDesc.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallOpParam.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogConfig.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pjmedia_vid_dev_hwnd_type.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_unsigned_char.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_sip_timer_use.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVector.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnBuddyEvSubStateParam.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsConfig.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfoVector.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JsonDocument.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SrtpCrypto.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfoVector.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SdpSession.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_bool_t.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountIpChangeConfig.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfoVector.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_dialog_cap_status.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipRxData.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidDevManager.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_mode.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamInfo.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LossType.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaStateParam.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_vid_strm_op.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_p_void.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertInfo.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RegProgressParam.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_dir.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountRegConfig.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_vid_req_keyframe_method.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayerInfo.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/FindBuddyMatch.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageParam.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_verify_flag_t.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRedirectedParam.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEvent.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtpVector.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMwiConfig.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/EpConfig.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxOption.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_wmm_prio.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ip_change_op.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UaConfig.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFmtChangedEvent.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_id.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowInfo.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaTransportInfo.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaEventParam.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxMsgEvent.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallStateParam.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tp_proto.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountPresConfig.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTsxStateParam.java
#11 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageStatusParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_type.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PendingJob.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_flag.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_params.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2Constants.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_format_id.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_turn_tp_type.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPart.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEventSrc.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_invalid_id_const_.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Media.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnDtmfDigitParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyVector.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountCallConfig.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMediaConfig.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowHandle.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentDocument.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogEntry.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportSrtpParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresenceStatus.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaRecorder.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_desc.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountNatConfig.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_evsub_state.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfoVector.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaConfig.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfoVector.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTxOfferParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindow.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeaderVector.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimeVal.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Account.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyInfo.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_ssize_t.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneGenerator.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendInstantMessageParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaCoordinate.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplacedParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTransportStateParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit_map.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_crypto_option.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfo.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RxMsgEvent.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Call.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapDigit.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallSdpCreatedParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxErrorEvent.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaVector.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallVidSetStreamParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ConfPortInfo.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_file_access.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_player_option.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEventBody.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamDestroyedParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_nat64_opt.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_id.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidCodecParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpSdes.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTimerParam.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_tsx_state_e.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_redirect_op.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMedia.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_role_e.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeader.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStat.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_hold_type.java
#11 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_std_index.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_sock_proto.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingCallParam.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTypingIndicationParam.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_stream_rc_method.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudDevManager.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Endpoint.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_writer_option.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIpChangeProgressParam.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_state.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPartVector.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_type.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreview.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferStatusParam.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_orient.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEvent.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_flag.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_stun_nat_type.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaSize.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapVector.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVideo.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitVector.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MathStat.java
#11 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportInfo.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_create_media_transport_flag.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStartedParam.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallInfo.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountSipConfig.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresNotifyParam.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMediaType.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplaceRequestParam.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_ssl_method.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cipher.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreviewOpParam.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertName.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParam.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UserEvent.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamSetting.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatCheckStunServersCompleteParam.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_hdr_e.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfo.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsInfo.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatAudio.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEvent.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_med_tp_st.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigit.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_type_e.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_inv_state.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnMwiInfoParam.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Buddy.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStreamStat.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportConfig.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimerEvent.java
#11 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JbufState.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountConfig.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IntVector.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_route.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyConfig.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormat.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogWriter.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Error.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_100rel_use.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ContainerNode.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_buddy_status.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2JNI.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_std__vectorT_pj__MediaFormat_t.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfo.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountInfo.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_state.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoSwitchParam.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSetting.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Version.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SslCertName_t.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfo.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_void.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_constants_.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferRequestParam.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaTransportStateParam.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StringVector.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_cap.java
#11 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SrtpCrypto_t.java
#11 21.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEventData.java
#11 21.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountVideoConfig.java
#11 21.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatDetectionCompleteParam.java
#11 21.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDescVector.java
#11 21.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/
#11 21.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/
#11 21.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/VialerPJSIP
#11 21.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia.h
#11 21.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/
#11 21.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_simple.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/ZsrtpCWrapper.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2.hpp
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/transport_zrtp.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_videodev.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_auth.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_audiodev.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib++.hpp
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_ua.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketGoClear.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheFile.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCodes.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHello.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Decode.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStateClass.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketBase.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecord.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPing.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallback.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheDb.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallbackWrapper.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Encode.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHelloAck.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZRtp.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpCacheDbBackend.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpTextData.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/Base32.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConf2Ack.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordDb.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketError.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCWrapper.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpSdesStream.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpPacket.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketSASrelay.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpUserCallback.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketClearAck.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStates.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpConfigure.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCache.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketRelayAck.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConfirm.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCrc32.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketDHPart.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordFile.h
#11 21.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketErrorAck.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPingAck.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/EmojiBase32.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketCommit.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/json.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/persistent.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/doxygen.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/config.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/siptypes.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/account.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/endpoint.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/call.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/presence.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/media.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/types.hpp
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem2.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl3.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ossl_typ.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dtls1.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/err.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bn.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/blowfish.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cms.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/engine.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf_api.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1_mac.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_x86_64.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/kssl.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7s.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/sha.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/symhacks.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_i386.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bio.h
#11 21.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc2.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dh.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui_compat.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509v3.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl23.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md5.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509_vfy.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/txt_db.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/safestack.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdsa.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/objects.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs12.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/crypto.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslv.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs7.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/obj_mac.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/buffer.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srp.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/camellia.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_arm64.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/evp.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/e_os2.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md4.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/hmac.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/aes.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/comp.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cast.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc4.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/stack.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ocsp.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ec.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdh.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rand.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ts.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pqueue.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dso.h
#11 21.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/seed.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/modes.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl2.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rsa.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/krb5_asn.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des_old.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ripemd.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/whrlpool.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/tls1.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/mdc2.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dsa.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srtp.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1t.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cmac.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ebcdic.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/idea.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/lhash.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/hash.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/lock.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/proactor.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/file.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/list.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/pool.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/timer.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/string.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/tree.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/scanner.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/types.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/os.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/sock.hpp
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/types.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/presence.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/iscomposing.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/rpid.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/pidf.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/mwi.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/publish.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/errno.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/xpidf.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub_msg.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_msg.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/config.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/types.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_sock.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_session.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/nat_detect.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_strans.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_session.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_sock.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/errno.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_config.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_session.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_transaction.h
#11 21.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_auth.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opencore_amr.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opus.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_sdp_match.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ffmpeg_vid_codecs.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/speex.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/passthrough.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h.in
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/types.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/silk.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ilbc.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/gsm.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221_sdp_match.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g722.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/bcg729.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h264_packetizer.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h263_packetizer.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_helper.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/audio_codecs.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ipp_codecs.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/l16.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/vid_toolbox.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/openh264.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_console.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_bitwise.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/http_client.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/base64.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/config.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/types.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_imp.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/md5.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns_server.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_md5.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/getopt.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_uint.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/xml.h
#11 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/json.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/resolver.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_sha1.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_telnet.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/srv_resolver.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/pcap.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/sha1.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/errno.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/stun_simple.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/crc32.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/string.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_ver.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_def.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_api.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_app_def.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_100rel.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_inv.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_xfer.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_regc.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_replaces.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_timer.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/config.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/opengl_dev.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/errno.h
#11 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev_imp.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/avi_dev.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/config.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev_imp.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/errno.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiotest.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_module.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_types.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_tel_uri.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_event.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_util.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tcp.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_loop.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_msg.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_private.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_endpoint.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tls.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_multipart.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_parser.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h.in
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_msg.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_uri.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_ua_layer.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transaction.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_udp.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/print_util.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_errno.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_dialog.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_parser.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_config.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_aka.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_resolve.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua_internal.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_multistream.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_types.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_defines.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_port.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/circbuf.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/conference.h
#11 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/resample.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/endpoint.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_playlist.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/bidirectional.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_tee.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/port.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/symbian_sound_aps.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_srtp.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/delaybuf.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stereo.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h.in
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp_xr.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/event.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/types.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/tonegen.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/videodev.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi_stream.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/null_port.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtp.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/audiodev.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/silencedet.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/frame.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_loop.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/converter.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wsola.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_port.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/alaw_ulaw.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp_neg.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo_port.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/codec.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/session.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/signatures.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/splitcomb.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec_util.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_ice.h
#11 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_stream.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/plc.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream_common.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/errno.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/g711.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wave.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/doxygen.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/format.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound_port.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/jbuf.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/clock.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_adapter_sample.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/master_port.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/mem_port.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_udp.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ip_helper.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_io.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ssl_sock.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_select.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/types.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/limits.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site_sample.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/lock.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/os.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/guid.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/fifobuf.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_i.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list_i.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/except.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_access.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/timer.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/unicode.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rbtree.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/activesock.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/log.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ctype.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_qos.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/array.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string_i.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rand.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/addr_resolv.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/math.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/errno.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ioqueue.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/doxygen.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/assert.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/hash.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_alt.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_buf.h
#11 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/time.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_sunos.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_m68k.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/malloc.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_msvc.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_armv4.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux_kernel.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/limits.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32_wince.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_armcc.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_powerpc.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_rtems.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/high_precision.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_codew.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcce.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_x86_64.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h.in
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/setjmp.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_darwinos.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winuwp.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdfileio.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_alpha.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/ctype.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_mwcc.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_symbian.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/rand.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/errno.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdarg.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/size_t.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h.in
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_i386.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/assert.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcc.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/socket.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winphone8.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_palmos.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/string.h
#11 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_sparc.h
#11 22.04 .../node_modules/react-native-pjsip postinstall: Done
#11 23.71 
#11 23.71 dependencies:
#11 23.71 + @expo/vector-icons 15.0.3
#11 23.71 + @react-native-async-storage/async-storage 2.2.0
#11 23.71 + @react-navigation/bottom-tabs 7.8.12
#11 23.71 + @react-navigation/elements 2.9.2
#11 23.71 + @react-navigation/native 7.1.25
#11 23.71 + @tanstack/react-query 5.90.12
#11 23.71 + @trpc/client 11.7.2
#11 23.71 + @trpc/react-query 11.7.2
#11 23.71 + @trpc/server 11.7.2
#11 23.71 + @types/pg 8.20.0
#11 23.71 + axios 1.13.2
#11 23.71 + clsx 2.1.1
#11 23.71 + cookie 1.1.1
#11 23.71 + dotenv 16.6.1
#11 23.71 + drizzle-orm 0.44.7
#11 23.71 + expo 54.0.29
#11 23.71 + expo-audio 1.1.0
#11 23.71 + expo-build-properties 1.0.10
#11 23.71 + expo-constants 18.0.12
#11 23.71 + expo-dev-client 6.0.21
#11 23.71 + expo-font 14.0.10
#11 23.71 + expo-haptics 15.0.8
#11 23.71 + expo-image 3.0.11
#11 23.71 + expo-keep-awake 15.0.8
#11 23.71 + expo-linking 8.0.10
#11 23.71 + expo-notifications 0.32.15
#11 23.71 + expo-router 6.0.19
#11 23.71 + expo-secure-store 15.0.8
#11 23.71 + expo-splash-screen 31.0.12
#11 23.71 + expo-status-bar 3.0.9
#11 23.71 + expo-symbols 1.0.8
#11 23.71 + expo-system-ui 6.0.9
#11 23.71 + expo-video 3.0.15
#11 23.71 + expo-web-browser 15.0.10
#11 23.71 + express 4.22.1
#11 23.71 + google-auth-library 10.6.2
#11 23.71 + ioredis 5.10.1
#11 23.71 + jose 6.1.0
#11 23.71 + mysql2 3.16.0
#11 23.71 + nativewind 4.2.1
#11 23.71 + pg 8.20.0
#11 23.71 + react 19.1.0
#11 23.71 + react-dom 19.1.0
#11 23.71 + react-native 0.81.5
#11 23.71 + react-native-callkeep 4.3.16
#11 23.71 + react-native-gesture-handler 2.28.0
#11 23.71 + react-native-pjsip 2.7.4
#11 23.71 + react-native-reanimated 4.1.6
#11 23.71 + react-native-safe-area-context 5.6.2
#11 23.71 + react-native-screens 4.16.0
#11 23.71 + react-native-svg 15.12.1
#11 23.71 + react-native-web 0.21.2
#11 23.71 + react-native-worklets 0.5.1
#11 23.71 + superjson 1.13.3
#11 23.71 + tailwind-merge 2.6.0
#11 23.71 + zod 4.2.1
#11 23.71 + zustand 5.0.12
#11 23.71 
#11 23.71 devDependencies: skipped
#11 23.71 
#11 23.74 
#11 23.74 > phone11-mobile@1.0.0 postinstall /app
#11 23.74 > node scripts/patch-react-native-pjsip.mjs && node scripts/fix-pjsip-podspec-ruby.mjs
#11 23.74 
#11 23.79 [phone11-pjsip-patch] Wrote iOS podspec: /app/node_modules/react-native-pjsip/react-native-pjsip.podspec; vendored_frameworks=ios/VialerPJSIP.framework
#11 23.80 [phone11-pjsip-patch] Wrote iOS PjSipModule legacy bridge export: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#11 23.80 [phone11-pjsip-patch] Verified iOS PjSipModule legacy bridge export: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#11 23.81 [phone11-pjsip-patch] Wrote iOS registration payload patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipAccount.m
#11 23.82 [phone11-pjsip-patch] Wrote iOS audio callback patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#11 23.83 [phone11-pjsip-patch] Wrote iOS safe string patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipUtil.m
#11 23.83 [phone11-pjsip-patch] Wrote iOS media bridge patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipCall.m
#11 23.91 [phone11-pjsip-patch] Patched react-native-pjsip iOS/Android native config.
#11 23.95 [phone11-pjsip-podspec-ruby] Podspec Ruby quoting already valid.
#11 23.95 Done in 23.6s
#11 ...

#12 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#12 18.84 .../node_modules/react-native-pjsip postinstall:  51 72.40M  51 37.55M   0      0 34.03M      0   00:02   00:01   00:01 37.58M
#12 19.84 .../node_modules/react-native-pjsip postinstall:  79 72.40M  79 57.32M   0      0 27.24M      0   00:02   00:02         28.66M
#12 19.95 .../node_modules/react-native-pjsip postinstall:  99 72.40M  99 71.70M   0      0 23.09M      0   00:03   00:03         23.89M
#12 19.95 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 22.52M      0   00:03   00:03         23.89M
#12 19.95 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 22.52M      0   00:03   00:03         23.89M
#12 19.95 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 22.52M      0   00:03   00:03         23.89M
#12 19.96 .../node_modules/react-native-pjsip postinstall: ./
#12 20.37 .../node_modules/react-native-pjsip postinstall: ./ios/
#12 20.37 .../node_modules/react-native-pjsip postinstall: ./android/
#12 20.37 .../node_modules/react-native-pjsip postinstall: ./android/src/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libopenh264.so
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libpjsua2.so
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libopenh264.so
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libpjsua2.so
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libopenh264.so
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libpjsua2.so
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libopenh264.so
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libpjsua2.so
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCameraInfo.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCamera.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentObject.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnSelectAccountParam.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTransaction.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStateParam.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_name_type.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamInfo.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IpChangeParam.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ipv6_use.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingSubscribeParam.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportParam.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtp.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjrpid_activity.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_log_decoration.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/WindowHandle.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamCreatedParam.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_flags_e.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfo.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_packing.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_event_type.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_destroy_flag.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxData.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_event_id_e.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_stun_use.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_cap.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_cred_data_type.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendTypingIndicationParam.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_status_code.java
#12 20.38 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_use.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSendRequestParam.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_media_status.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRxOfferParam.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamStat.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayer.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDesc.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallOpParam.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogConfig.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pjmedia_vid_dev_hwnd_type.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_unsigned_char.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_sip_timer_use.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVector.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnBuddyEvSubStateParam.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsConfig.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfoVector.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JsonDocument.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SrtpCrypto.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfoVector.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SdpSession.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_bool_t.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountIpChangeConfig.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfoVector.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_dialog_cap_status.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipRxData.java
#12 20.39 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidDevManager.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_mode.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamInfo.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LossType.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaStateParam.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_vid_strm_op.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_p_void.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertInfo.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RegProgressParam.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_dir.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountRegConfig.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_vid_req_keyframe_method.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayerInfo.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/FindBuddyMatch.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageParam.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_verify_flag_t.java
#12 20.40 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRedirectedParam.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEvent.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtpVector.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMwiConfig.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/EpConfig.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxOption.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_wmm_prio.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ip_change_op.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UaConfig.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFmtChangedEvent.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_id.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowInfo.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaTransportInfo.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaEventParam.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxMsgEvent.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallStateParam.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tp_proto.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountPresConfig.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTsxStateParam.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageStatusParam.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_type.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PendingJob.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_flag.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_params.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2Constants.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_format_id.java
#12 20.41 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_turn_tp_type.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPart.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEventSrc.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_invalid_id_const_.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Media.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnDtmfDigitParam.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyVector.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountCallConfig.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMediaConfig.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowHandle.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentDocument.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogEntry.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportSrtpParam.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresenceStatus.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaRecorder.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_desc.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountNatConfig.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_evsub_state.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfoVector.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaConfig.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfoVector.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTxOfferParam.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindow.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeaderVector.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimeVal.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Account.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyInfo.java
#12 20.42 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_ssize_t.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneGenerator.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendInstantMessageParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaCoordinate.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplacedParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTransportStateParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit_map.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_crypto_option.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfo.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RxMsgEvent.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Call.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapDigit.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallSdpCreatedParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxErrorEvent.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaVector.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallVidSetStreamParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ConfPortInfo.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_file_access.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_player_option.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEventBody.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamDestroyedParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_nat64_opt.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_id.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidCodecParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpSdes.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTimerParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_tsx_state_e.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_redirect_op.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMedia.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_role_e.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeader.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStat.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_hold_type.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_std_index.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_sock_proto.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingCallParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTypingIndicationParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_stream_rc_method.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudDevManager.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Endpoint.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_writer_option.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIpChangeProgressParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_state.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPartVector.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_type.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreview.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferStatusParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_orient.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEvent.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_flag.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_stun_nat_type.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaSize.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapVector.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVideo.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitVector.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MathStat.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportInfo.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_create_media_transport_flag.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStartedParam.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallInfo.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountSipConfig.java
#12 20.43 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresNotifyParam.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMediaType.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplaceRequestParam.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_ssl_method.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cipher.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreviewOpParam.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertName.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParam.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UserEvent.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamSetting.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatCheckStunServersCompleteParam.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_hdr_e.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfo.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsInfo.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatAudio.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEvent.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_med_tp_st.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigit.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_type_e.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_inv_state.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnMwiInfoParam.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Buddy.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStreamStat.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportConfig.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimerEvent.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JbufState.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountConfig.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IntVector.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_route.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyConfig.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormat.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogWriter.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Error.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_100rel_use.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ContainerNode.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_buddy_status.java
#12 20.44 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2JNI.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_std__vectorT_pj__MediaFormat_t.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfo.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountInfo.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_state.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoSwitchParam.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSetting.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Version.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SslCertName_t.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfo.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_void.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_constants_.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferRequestParam.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaTransportStateParam.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StringVector.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_cap.java
#12 20.45 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SrtpCrypto_t.java
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEventData.java
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountVideoConfig.java
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatDetectionCompleteParam.java
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDescVector.java
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/VialerPJSIP
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_simple.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/ZsrtpCWrapper.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2.hpp
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/transport_zrtp.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_videodev.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_auth.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_audiodev.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib++.hpp
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_ua.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketGoClear.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheFile.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCodes.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHello.h
#12 21.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Decode.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStateClass.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketBase.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecord.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPing.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallback.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheDb.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallbackWrapper.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Encode.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHelloAck.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZRtp.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpCacheDbBackend.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpTextData.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/Base32.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConf2Ack.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordDb.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketError.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCWrapper.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpSdesStream.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpPacket.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketSASrelay.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpUserCallback.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketClearAck.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStates.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpConfigure.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCache.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketRelayAck.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConfirm.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCrc32.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketDHPart.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordFile.h
#12 21.83 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketErrorAck.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPingAck.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/EmojiBase32.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketCommit.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/json.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/persistent.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/doxygen.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/config.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/siptypes.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/account.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/endpoint.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/call.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/presence.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/media.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/types.hpp
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem2.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl3.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ossl_typ.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dtls1.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/err.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bn.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/blowfish.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cms.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/engine.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf_api.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1_mac.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_x86_64.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/kssl.h
#12 21.84 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7s.h
#12 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/sha.h
#12 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/symhacks.h
#12 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1.h
#12 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf.h
#12 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_i386.h
#12 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bio.h
#12 21.85 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc2.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dh.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui_compat.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509v3.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl23.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md5.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509_vfy.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/txt_db.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/safestack.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdsa.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/objects.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs12.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/crypto.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslv.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs7.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/obj_mac.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/buffer.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srp.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/camellia.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_arm64.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/evp.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/e_os2.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md4.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/hmac.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/aes.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/comp.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cast.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc4.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/stack.h
#12 21.86 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ocsp.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ec.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdh.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rand.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ts.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pqueue.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dso.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/seed.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/modes.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl2.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rsa.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/krb5_asn.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des_old.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ripemd.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/whrlpool.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/tls1.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/mdc2.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dsa.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srtp.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1t.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cmac.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ebcdic.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/idea.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/lhash.h
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/hash.hpp
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/lock.hpp
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/proactor.hpp
#12 21.87 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/file.hpp
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/list.hpp
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/pool.hpp
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/timer.hpp
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/string.hpp
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/tree.hpp
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/scanner.hpp
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/types.hpp
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/os.hpp
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/sock.hpp
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/types.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/presence.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/iscomposing.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/rpid.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/pidf.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/mwi.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/publish.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/errno.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/xpidf.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub_msg.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_msg.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/config.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/types.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_sock.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_session.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/nat_detect.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_strans.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_session.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_sock.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/errno.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_config.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_session.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_transaction.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_auth.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opencore_amr.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opus.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_sdp_match.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ffmpeg_vid_codecs.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/speex.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/passthrough.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h.in
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/types.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/silk.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ilbc.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/gsm.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221_sdp_match.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g722.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/bcg729.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h264_packetizer.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h263_packetizer.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_helper.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/audio_codecs.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ipp_codecs.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/l16.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/vid_toolbox.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/openh264.h
#12 21.88 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_console.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_bitwise.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/http_client.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/base64.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/config.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/types.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_imp.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/md5.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns_server.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_md5.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/getopt.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_uint.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/xml.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/json.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/resolver.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_sha1.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_telnet.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/srv_resolver.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/pcap.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/sha1.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/errno.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/stun_simple.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/crc32.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/string.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_ver.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_def.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_api.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_app_def.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_100rel.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_inv.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_xfer.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_regc.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_replaces.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_timer.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/config.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/opengl_dev.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/errno.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev_imp.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/avi_dev.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/config.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev_imp.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/errno.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiotest.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_module.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_types.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_tel_uri.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_event.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_util.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tcp.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_loop.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_msg.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_private.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_endpoint.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tls.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_multipart.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_parser.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h.in
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_msg.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_uri.h
#12 21.89 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_ua_layer.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transaction.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_udp.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/print_util.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_errno.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_dialog.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_parser.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_config.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_aka.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_resolve.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua_internal.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_multistream.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_types.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_defines.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_port.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/circbuf.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/conference.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/resample.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/endpoint.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_playlist.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/bidirectional.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_tee.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/port.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/symbian_sound_aps.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_srtp.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/delaybuf.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stereo.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h.in
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp_xr.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/event.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/types.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/tonegen.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/videodev.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi_stream.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/null_port.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtp.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/audiodev.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/silencedet.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/frame.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_loop.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/converter.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wsola.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_port.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/alaw_ulaw.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp_neg.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo_port.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/codec.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/session.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/signatures.h
#12 21.90 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/splitcomb.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec_util.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_ice.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_stream.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/plc.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream_common.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/errno.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/g711.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wave.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/doxygen.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/format.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound_port.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/jbuf.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/clock.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_adapter_sample.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/master_port.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/mem_port.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_udp.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ip_helper.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_io.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ssl_sock.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_select.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/types.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/limits.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site_sample.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/lock.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/os.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/guid.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/fifobuf.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_i.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list_i.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/except.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_access.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/timer.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/unicode.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rbtree.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/activesock.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/log.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ctype.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_qos.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/array.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string_i.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rand.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/addr_resolv.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/math.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/errno.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ioqueue.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/doxygen.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/assert.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/hash.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_alt.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_buf.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/time.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_sunos.h
#12 21.91 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_m68k.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/malloc.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_msvc.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_armv4.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux_kernel.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/limits.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32_wince.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_armcc.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_powerpc.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_rtems.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/high_precision.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_codew.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcce.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_x86_64.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h.in
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/setjmp.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_darwinos.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winuwp.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdfileio.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_alpha.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/ctype.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_mwcc.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_symbian.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/rand.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/errno.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdarg.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/size_t.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h.in
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_i386.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/assert.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcc.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/socket.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winphone8.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_palmos.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/string.h
#12 21.92 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_sparc.h
#12 21.93 .../node_modules/react-native-pjsip postinstall: Done
#12 23.64 
#12 23.64 dependencies:
#12 23.64 + @expo/vector-icons 15.0.3
#12 23.64 + @react-native-async-storage/async-storage 2.2.0
#12 23.64 + @react-navigation/bottom-tabs 7.8.12
#12 23.64 + @react-navigation/elements 2.9.2
#12 23.64 + @react-navigation/native 7.1.25
#12 23.64 + @tanstack/react-query 5.90.12
#12 23.64 + @trpc/client 11.7.2
#12 23.64 + @trpc/react-query 11.7.2
#12 23.64 + @trpc/server 11.7.2
#12 23.64 + @types/pg 8.20.0
#12 23.64 + axios 1.13.2
#12 23.64 + clsx 2.1.1
#12 23.64 + cookie 1.1.1
#12 23.64 + dotenv 16.6.1
#12 23.64 + drizzle-orm 0.44.7
#12 23.64 + expo 54.0.29
#12 23.64 + expo-audio 1.1.0
#12 23.64 + expo-build-properties 1.0.10
#12 23.64 + expo-constants 18.0.12
#12 23.64 + expo-dev-client 6.0.21
#12 23.64 + expo-font 14.0.10
#12 23.64 + expo-haptics 15.0.8
#12 23.64 + expo-image 3.0.11
#12 23.64 + expo-keep-awake 15.0.8
#12 23.64 + expo-linking 8.0.10
#12 23.64 + expo-notifications 0.32.15
#12 23.64 + expo-router 6.0.19
#12 23.64 + expo-secure-store 15.0.8
#12 23.64 + expo-splash-screen 31.0.12
#12 23.64 + expo-status-bar 3.0.9
#12 23.64 + expo-symbols 1.0.8
#12 23.64 + expo-system-ui 6.0.9
#12 23.64 + expo-video 3.0.15
#12 23.64 + expo-web-browser 15.0.10
#12 23.64 + express 4.22.1
#12 23.64 + google-auth-library 10.6.2
#12 23.64 + ioredis 5.10.1
#12 23.64 + jose 6.1.0
#12 23.64 + mysql2 3.16.0
#12 23.64 + nativewind 4.2.1
#12 23.64 + pg 8.20.0
#12 23.64 + react 19.1.0
#12 23.64 + react-dom 19.1.0
#12 23.64 + react-native 0.81.5
#12 23.64 + react-native-callkeep 4.3.16
#12 23.64 + react-native-gesture-handler 2.28.0
#12 23.64 + react-native-pjsip 2.7.4
#12 23.64 + react-native-reanimated 4.1.6
#12 23.64 + react-native-safe-area-context 5.6.2
#12 23.64 + react-native-screens 4.16.0
#12 23.64 + react-native-svg 15.12.1
#12 23.64 + react-native-web 0.21.2
#12 23.64 + react-native-worklets 0.5.1
#12 23.64 + superjson 1.13.3
#12 23.64 + tailwind-merge 2.6.0
#12 23.64 + zod 4.2.1
#12 23.64 + zustand 5.0.12
#12 23.64 
#12 23.64 devDependencies:
#12 23.64 + @config-plugins/react-native-callkeep 12.0.0
#12 23.64 + @expo/ngrok 4.1.3
#12 23.64 + @types/cookie 0.6.0
#12 23.64 + @types/express 4.17.25
#12 23.64 + @types/node 22.19.3
#12 23.64 + @types/qrcode 1.5.6
#12 23.64 + @types/react 19.1.17
#12 23.64 + concurrently 9.2.1
#12 23.64 + cross-env 7.0.3
#12 23.64 + drizzle-kit 0.31.8
#12 23.64 + esbuild 0.25.12
#12 23.64 + eslint 9.39.2
#12 23.64 + eslint-config-expo 10.0.0
#12 23.64 + prettier 3.7.4
#12 23.64 + qrcode 1.5.4
#12 23.64 + tailwindcss 3.4.19
#12 23.64 + tsx 4.21.0
#12 23.64 + typescript 5.9.3
#12 23.64 + vitest 2.1.9
#12 23.64 
#12 23.79 
#12 23.79 > phone11-mobile@1.0.0 postinstall /app
#12 23.79 > node scripts/patch-react-native-pjsip.mjs && node scripts/fix-pjsip-podspec-ruby.mjs
#12 23.79 
#12 23.84 [phone11-pjsip-patch] Wrote iOS podspec: /app/node_modules/react-native-pjsip/react-native-pjsip.podspec; vendored_frameworks=ios/VialerPJSIP.framework
#12 23.85 [phone11-pjsip-patch] Wrote iOS PjSipModule legacy bridge export: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#12 23.85 [phone11-pjsip-patch] Verified iOS PjSipModule legacy bridge export: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#12 23.86 [phone11-pjsip-patch] Wrote iOS registration payload patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipAccount.m
#12 23.86 [phone11-pjsip-patch] Wrote iOS audio callback patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#12 23.88 [phone11-pjsip-patch] Wrote iOS safe string patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipUtil.m
#12 23.88 [phone11-pjsip-patch] Wrote iOS media bridge patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipCall.m
#12 24.10 [phone11-pjsip-patch] Patched react-native-pjsip iOS/Android native config.
#12 24.15 [phone11-pjsip-podspec-ruby] Podspec Ruby quoting already valid.
#12 24.16 Done in 23.8s
#12 DONE 27.4s

#11 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#11 DONE 27.4s

#13 [backend deps 8/8] RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
#13 ...

#14 [backend builder  8/13] COPY server/ ./server/
#14 DONE 1.2s

#15 [backend builder  9/13] COPY shared/ ./shared/
#15 DONE 0.0s

#16 [backend builder 10/13] COPY drizzle/ ./drizzle/
#16 DONE 0.0s

#17 [backend builder 11/13] COPY drizzle.config.ts ./
#17 DONE 0.0s

#18 [backend builder 12/13] COPY tsconfig.json ./
#18 DONE 0.0s

#13 [backend deps 8/8] RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
#13 DONE 1.8s

#19 [backend builder 13/13] RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
#19 0.651 
#19 0.651   dist/index.mjs  192.9kb
#19 0.651 
#19 0.651 ⚡ Done in 19ms
#19 DONE 0.7s

#20 [backend production 3/7] RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone &&     mkdir -p /var/lib/phone11/recordings /var/lib/phone11/voicemail &&     chown -R cloudphone:cloudphone /var/lib/phone11
#20 CACHED

#21 [backend production 4/7] COPY --from=deps /app/node_modules ./node_modules
#21 DONE 36.7s

#22 [backend production 5/7] COPY --from=builder /app/dist ./dist
#22 DONE 0.4s

#23 [backend production 6/7] COPY --from=builder /app/drizzle ./drizzle
#23 DONE 0.4s

#24 [backend production 7/7] COPY package.json ./
#24 DONE 0.0s

#25 [backend] exporting to image
#25 exporting layers
#25 exporting layers 38.7s done
#25 exporting manifest sha256:7a96a69bb52d8f7d650925be7e32794dfbb8ea5f4efb7dcaf56062ecebfa976a 0.0s done
#25 exporting config sha256:3020e26253f9d35a851ee242f7f3d4395d79eb9b589f0d86d57b49c1ece22866 0.0s done
#25 exporting attestation manifest sha256:b5234ccadeeaea6647eb3d9225aea80871ab01d322782cef782d8ba3a5a70bee 0.0s done
#25 exporting manifest list sha256:42e7f64668fb688e7e4b9cc79439df0b6f7b43123b99eabe9c67db093660e3b8 0.0s done
#25 naming to docker.io/library/cloudphone11-prod-backend:latest done
#25 unpacking to docker.io/library/cloudphone11-prod-backend:latest
#25 unpacking to docker.io/library/cloudphone11-prod-backend:latest 7.3s done
#25 DONE 46.1s

#26 [backend] resolving provenance for metadata file
#26 DONE 0.0s
 backend  Built
 Container cp11-postgres  Running
 Container cp11-redis  Running
 Container cp11-backend  Recreate
 Container cp11-backend  Recreated
 Container cp11-redis  Waiting
 Container cp11-postgres  Waiting
 Container cp11-postgres  Healthy
 Container cp11-redis  Healthy
 Container cp11-backend  Starting
 Container cp11-backend  Started
--- Waiting for backend container to stay running ---
Backend state: running restarting=false exit=0
--- Checking RDS managed secret for DB password repair ---
DB env is incomplete; skipping DB password repair.
--- Verifying backend DB env and pilot extension ---
Backend DB env present: host=postgres, user=phone11ai, database=phone11ai, ssl=disabled, password=<set>
Backend PG auth OK as phone11ai on phone11ai
Pilot extension ready: 1001 on sip.phone11.ai
--- Waiting for backend container to stay running ---
Backend state: running restarting=false exit=0
--- Waiting for backend health endpoint ---
Health not ready: curl: (56) Recv failure: Connection reset by peer
{"ok":true,"timestamp":1779843811032,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
--- Verifying public api.phone11.ai route ---
Public health: {"ok":true,"timestamp":1779843811068,"build":"7b0c678eeff3893ce53c964f17a88d76327299ab","service":"phone11-backend"}
ERROR: public API answered, but it is not serving this deploy commit.
Expected build marker: 14055c1e5c77967c65941b674c6a8e7c8e9ab1ff
--- Public API route diagnostics ---
DNS for api.phone11.ai:
43.209.112.208  STREAM api.phone11.ai
43.209.112.208  DGRAM  
43.209.112.208  RAW    
Listening ports 80/443/3000/3001:
LISTEN 0      511          0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=1309581,fd=5),("nginx",pid=1309580,fd=5),("nginx",pid=1309579,fd=5),("nginx",pid=1309578,fd=5),("nginx",pid=1309575,fd=5))
LISTEN 0      4096       127.0.0.1:3000       0.0.0.0:*    users:(("docker-proxy",pid=224761,fd=7))                                                                                                      
LISTEN 0      511                *:3001             *:*    users:(("node",pid=1140499,fd=21))                                                                                                            
Docker containers:
cp11-backend cloudphone11-prod-backend 127.0.0.1:3000->3000/tcp
p11-kamailio ghcr.io/kamailio/kamailio:5.8.4-bookworm 
p11-rtpengine drachtio/rtpengine:latest 
cp11-redis redis:7-alpine 6379/tcp
cp11-postgres postgres:16-alpine 127.0.0.1:5432->5432/tcp
p11-freeswitch safarov/freeswitch:latest 
p11-redis redis:7-alpine 
Direct backend health:
{"ok":true,"timestamp":1779843811157,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
Local HTTP Host-route health:
{"ok":true,"timestamp":1779843811163,"build":"14055c1e5c77967c65941b674c6a8e7c8e9ab1ff","service":"phone11-backend"}
Local HTTPS Host-route health:

Nginx proxy snippets:

# configuration file /etc/nginx/sites-enabled/phone11ai:
server {
    listen 80;
    server_name phone11.ai 1toall.phone11.ai api.phone11.ai;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
--
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://10.0.1.69:8088;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
curl: (7) Failed to connect to api.phone11.ai port 443 after 0 ms: Couldn't connect to server
```
