# Phone11 V90 Live Backend Provisioning Status

- Time UTC: 2026-05-27T01:03:13+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 138bc625311b4a537524c718768e07eaf417070d
- Live EC2 host: 43.210.122.111
- Live EC2 instance: i-0851dd1ea1cfeef71
- Pilot user id: 1
- Latest app SIP password fingerprint from user log: 2b847b074c0ba53a
- Result: failure
- Exit code: 61

## Sanitized output
```text
=== Phone11 V90 live backend provisioning deploy and evidence ===
Time: 2026-05-27T01:00:49+00:00
Live EC2 host: 43.210.122.111
Expected latest app password fingerprint: 2b847b074c0ba53a
--- Locate live EC2 ---
Found live EC2 instance i-0851dd1ea1cfeef71 in ap-southeast-7a
--- Prepare temporary SSH access ---
{
    "RequestId": "a171dd2c-e5af-4e86-b395-4db5ce911e29",
    "Success": true
}
--- Copy deploy script to live EC2 ---
Warning: Permanently added '43.210.122.111' (ED25519) to the list of known hosts.
--- Redeploy current branch commit to live backend ---
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-27T01:01:09+00:00
GitHub SHA: 138bc625311b4a537524c718768e07eaf417070d
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
 * branch            138bc625311b4a537524c718768e07eaf417070d -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  14055c1 Add live backend provisioning credential evidence workflow

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> 14055c1

HEAD is now at 138bc62 Trigger Phone11 V90 live provisioning evidence
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-27T01:01:11Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 DONE 0.0s

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 3.25kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 0.8s

#3 [backend builder  1/13] FROM docker.io/library/node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
#3 resolve docker.io/library/node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 0.0s done
#3 DONE 0.0s

#4 [backend builder  4/13] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#4 CACHED

#5 [backend builder  2/13] WORKDIR /app
#5 CACHED

#6 [backend builder  3/13] RUN apk add --no-cache bash curl ca-certificates
#6 CACHED

#7 [backend builder  5/13] COPY package.json pnpm-lock.yaml ./
#7 CACHED

#8 [backend internal] load .dockerignore
#8 transferring context: 2B done
#8 DONE 0.0s

#9 [backend internal] load build context
#9 transferring context: 818.53kB 0.0s done
#9 DONE 0.0s

#10 [backend builder  5/13] COPY package.json pnpm-lock.yaml ./
#10 CACHED

#11 [backend builder  6/13] COPY scripts/ ./scripts/
#11 DONE 0.1s

#12 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#12 0.935 Lockfile is up to date, resolution step is skipped
#12 1.113 Progress: resolved 1, reused 0, downloaded 0, added 0
#12 1.448 Packages: +1158
#12 1.448 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#12 1.851 
#12 1.851    ╭──────────────────────────────────────────────────────────────────╮
#12 1.851    │                                                                  │
#12 1.851    │                Update available! 9.12.0 → 11.3.0.                │
#12 1.851    │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.3.0   │
#12 1.851    │         Run "corepack install -g pnpm@11.3.0" to update.         │
#12 1.851    │                                                                  │
#12 1.851    │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
#12 1.851    │                                                                  │
#12 1.851    ╰──────────────────────────────────────────────────────────────────╯
#12 1.851 
#12 2.116 Progress: resolved 1158, reused 0, downloaded 13, added 0
#12 3.119 Progress: resolved 1158, reused 0, downloaded 127, added 115
#12 4.125 Progress: resolved 1158, reused 0, downloaded 286, added 276
#12 5.125 Progress: resolved 1158, reused 0, downloaded 405, added 394
#12 6.125 Progress: resolved 1158, reused 0, downloaded 498, added 487
#12 7.126 Progress: resolved 1158, reused 0, downloaded 519, added 510
#12 8.131 Progress: resolved 1158, reused 0, downloaded 549, added 540
#12 9.130 Progress: resolved 1158, reused 0, downloaded 630, added 622
#12 ...

#13 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#13 0.924 Lockfile is up to date, resolution step is skipped
#13 1.039 Progress: resolved 1, reused 0, downloaded 0, added 0
#13 1.300 Packages: +899
#13 1.300 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#13 1.537 
#13 1.537    ╭──────────────────────────────────────────────────────────────────╮
#13 1.537    │                                                                  │
#13 1.537    │                Update available! 9.12.0 → 11.3.0.                │
#13 1.537    │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.3.0   │
#13 1.537    │         Run "corepack install -g pnpm@11.3.0" to update.         │
#13 1.537    │                                                                  │
#13 1.537    │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
#13 1.537    │                                                                  │
#13 1.537    ╰──────────────────────────────────────────────────────────────────╯
#13 1.537 
#13 2.045 Progress: resolved 899, reused 0, downloaded 33, added 20
#13 3.048 Progress: resolved 899, reused 0, downloaded 160, added 153
#13 4.055 Progress: resolved 899, reused 0, downloaded 349, added 340
#13 5.064 Progress: resolved 899, reused 0, downloaded 442, added 439
#13 6.065 Progress: resolved 899, reused 0, downloaded 506, added 494
#13 7.071 Progress: resolved 899, reused 0, downloaded 520, added 509
#13 8.072 Progress: resolved 899, reused 0, downloaded 542, added 534
#13 9.073 Progress: resolved 899, reused 0, downloaded 625, added 616
#13 10.07 Progress: resolved 899, reused 0, downloaded 656, added 645
#13 ...

#12 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#12 10.13 Progress: resolved 1158, reused 0, downloaded 680, added 670
#12 11.13 Progress: resolved 1158, reused 0, downloaded 714, added 701
#12 12.13 Progress: resolved 1158, reused 0, downloaded 799, added 788
#12 13.14 Progress: resolved 1158, reused 0, downloaded 849, added 835
#12 14.14 Progress: resolved 1158, reused 0, downloaded 903, added 893
#12 15.14 Progress: resolved 1158, reused 0, downloaded 944, added 937
#12 16.14 Progress: resolved 1158, reused 0, downloaded 1066, added 1060
#12 16.78 Progress: resolved 1158, reused 0, downloaded 1158, added 1158, done
#12 17.43 .../node_modules/unrs-resolver postinstall$ napi-postinstall unrs-resolver 1.11.1 check
#12 ...

#13 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#13 11.08 Progress: resolved 899, reused 0, downloaded 701, added 688
#13 12.09 Progress: resolved 899, reused 0, downloaded 777, added 767
#13 13.08 Progress: resolved 899, reused 0, downloaded 825, added 816
#13 14.09 Progress: resolved 899, reused 0, downloaded 882, added 870
#13 15.09 Progress: resolved 899, reused 0, downloaded 898, added 898
#13 15.46 Progress: resolved 899, reused 0, downloaded 899, added 899, done
#13 16.28 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
#13 16.29 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
#13 16.76 .../node_modules/react-native-pjsip postinstall:   % Total    % Received % Xferd  Average Speed  Time    Time    Time   Current
#13 16.76 .../node_modules/react-native-pjsip postinstall:                                  Dload  Upload  Total   Spent   Left   Speed
#13 16.88 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#13 16.88 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#13 16.88 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#13 17.08 .../esbuild@0.27.2/node_modules/esbuild postinstall: Done
#13 17.28 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#13 17.29 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 136.9M      0                              0
#13 17.29 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 136.9M      0                              0
#13 17.29 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 136.9M      0                              0
#13 17.30 .../node_modules/react-native-pjsip postinstall: ./
#13 ...

#12 [backend builder  7/13] RUN pnpm install --frozen-lockfile
#12 17.43 .../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
#12 17.43 .../esbuild@0.18.20/node_modules/esbuild postinstall$ node install.js
#12 17.43 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
#12 17.47 .../esbuild@0.21.5/node_modules/esbuild postinstall$ node install.js
#12 17.58 .../node_modules/unrs-resolver postinstall: Done
#12 17.59 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
#12 17.68 .../esbuild@0.18.20/node_modules/esbuild postinstall: Done
#12 17.68 .../esbuild@0.27.2/node_modules/esbuild postinstall: Done
#12 17.78 .../node_modules/react-native-pjsip postinstall:   % Total    % Received % Xferd  Average Speed  Time    Time    Time   Current
#12 17.78 .../node_modules/react-native-pjsip postinstall:                                  Dload  Upload  Total   Spent   Left   Speed
#12 17.83 .../esbuild@0.21.5/node_modules/esbuild postinstall: Done
#12 17.89 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#12 17.89 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#12 17.89 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#12 17.93 .../esbuild@0.25.12/node_modules/esbuild postinstall: Done
#12 18.21 .../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
#12 18.21 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 167.9M      0                              0
#12 18.21 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 167.6M      0                              0
#12 18.21 .../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 167.5M      0                              0
#12 18.22 .../node_modules/react-native-pjsip postinstall: ./
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./ios/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libopenh264.so
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libpjsua2.so
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libopenh264.so
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libpjsua2.so
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libopenh264.so
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libpjsua2.so
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libopenh264.so
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libpjsua2.so
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCameraInfo.java
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCamera.java
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentObject.java
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnSelectAccountParam.java
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTransaction.java
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStateParam.java
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_name_type.java
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamInfo.java
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IpChangeParam.java
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ipv6_use.java
#12 18.67 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingSubscribeParam.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportParam.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtp.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjrpid_activity.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_log_decoration.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/WindowHandle.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamCreatedParam.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_flags_e.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfo.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_packing.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_event_type.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_destroy_flag.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxData.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_event_id_e.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_stun_use.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_cap.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_cred_data_type.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendTypingIndicationParam.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_status_code.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_use.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSendRequestParam.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_media_status.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRxOfferParam.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamStat.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayer.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDesc.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallOpParam.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogConfig.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pjmedia_vid_dev_hwnd_type.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_unsigned_char.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_sip_timer_use.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVector.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnBuddyEvSubStateParam.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsConfig.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfoVector.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JsonDocument.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SrtpCrypto.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfoVector.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SdpSession.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_bool_t.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountIpChangeConfig.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfoVector.java
#12 18.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_dialog_cap_status.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipRxData.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidDevManager.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_mode.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamInfo.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LossType.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaStateParam.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_vid_strm_op.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_p_void.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertInfo.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RegProgressParam.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_dir.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountRegConfig.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_vid_req_keyframe_method.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayerInfo.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/FindBuddyMatch.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageParam.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_verify_flag_t.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRedirectedParam.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEvent.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtpVector.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMwiConfig.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/EpConfig.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxOption.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_wmm_prio.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ip_change_op.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UaConfig.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFmtChangedEvent.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_id.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowInfo.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaTransportInfo.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaEventParam.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxMsgEvent.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallStateParam.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tp_proto.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountPresConfig.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTsxStateParam.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageStatusParam.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_type.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PendingJob.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_flag.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_params.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2Constants.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_format_id.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_turn_tp_type.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPart.java
#12 18.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEventSrc.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_invalid_id_const_.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Media.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnDtmfDigitParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyVector.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountCallConfig.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMediaConfig.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowHandle.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentDocument.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogEntry.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportSrtpParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresenceStatus.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaRecorder.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_desc.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountNatConfig.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_evsub_state.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfoVector.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaConfig.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfoVector.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTxOfferParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindow.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeaderVector.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimeVal.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Account.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyInfo.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_ssize_t.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneGenerator.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendInstantMessageParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaCoordinate.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplacedParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTransportStateParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit_map.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_crypto_option.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfo.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RxMsgEvent.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Call.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapDigit.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallSdpCreatedParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxErrorEvent.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaVector.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallVidSetStreamParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ConfPortInfo.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_file_access.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_player_option.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEventBody.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamDestroyedParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_nat64_opt.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_id.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidCodecParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpSdes.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTimerParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_tsx_state_e.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_redirect_op.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMedia.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_role_e.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeader.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStat.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_hold_type.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_std_index.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_sock_proto.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingCallParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTypingIndicationParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_stream_rc_method.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudDevManager.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Endpoint.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_writer_option.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIpChangeProgressParam.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_state.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPartVector.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_type.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreview.java
#12 18.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferStatusParam.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_orient.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEvent.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_flag.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_stun_nat_type.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaSize.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapVector.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVideo.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitVector.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MathStat.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportInfo.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_create_media_transport_flag.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStartedParam.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallInfo.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountSipConfig.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresNotifyParam.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMediaType.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplaceRequestParam.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_ssl_method.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cipher.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreviewOpParam.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertName.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParam.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UserEvent.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamSetting.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatCheckStunServersCompleteParam.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_hdr_e.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfo.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsInfo.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatAudio.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEvent.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_med_tp_st.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigit.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_type_e.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_inv_state.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnMwiInfoParam.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Buddy.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStreamStat.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportConfig.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimerEvent.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JbufState.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountConfig.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IntVector.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_route.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyConfig.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormat.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogWriter.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Error.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_100rel_use.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ContainerNode.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_buddy_status.java
#12 18.71 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2JNI.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_std__vectorT_pj__MediaFormat_t.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfo.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountInfo.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_state.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoSwitchParam.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSetting.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Version.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SslCertName_t.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfo.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_void.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_constants_.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferRequestParam.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaTransportStateParam.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StringVector.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_cap.java
#12 18.72 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SrtpCrypto_t.java
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEventData.java
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountVideoConfig.java
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatDetectionCompleteParam.java
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDescVector.java
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/VialerPJSIP
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_simple.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/ZsrtpCWrapper.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2.hpp
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/transport_zrtp.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_videodev.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_auth.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_audiodev.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib++.hpp
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_ua.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketGoClear.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheFile.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCodes.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHello.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Decode.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStateClass.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketBase.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecord.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPing.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallback.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheDb.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallbackWrapper.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Encode.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHelloAck.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZRtp.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpCacheDbBackend.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpTextData.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/Base32.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConf2Ack.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordDb.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketError.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCWrapper.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpSdesStream.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpPacket.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketSASrelay.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpUserCallback.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketClearAck.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStates.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpConfigure.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCache.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketRelayAck.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConfirm.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCrc32.h
#12 20.11 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketDHPart.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordFile.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketErrorAck.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPingAck.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/EmojiBase32.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketCommit.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/json.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/persistent.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/doxygen.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/config.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/siptypes.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/account.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/endpoint.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/call.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/presence.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/media.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/types.hpp
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem2.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl3.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ossl_typ.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dtls1.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/err.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bn.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/blowfish.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cms.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/engine.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf_api.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1_mac.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_x86_64.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/kssl.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7s.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/sha.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/symhacks.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_i386.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bio.h
#12 20.12 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc2.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dh.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui_compat.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509v3.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl23.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md5.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509_vfy.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/txt_db.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/safestack.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdsa.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/objects.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs12.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/crypto.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslv.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs7.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/obj_mac.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/buffer.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srp.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/camellia.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_arm64.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/evp.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/e_os2.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md4.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/hmac.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/aes.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/comp.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cast.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc4.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/stack.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ocsp.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ec.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdh.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rand.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ts.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pqueue.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dso.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/seed.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/modes.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl2.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rsa.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/krb5_asn.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des_old.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ripemd.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/whrlpool.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/tls1.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/mdc2.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dsa.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srtp.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1t.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cmac.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ebcdic.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/idea.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/lhash.h
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/hash.hpp
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/lock.hpp
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/proactor.hpp
#12 20.13 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/file.hpp
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/list.hpp
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/pool.hpp
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/timer.hpp
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/string.hpp
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/tree.hpp
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/scanner.hpp
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/types.hpp
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/os.hpp
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/sock.hpp
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/types.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/presence.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/iscomposing.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/rpid.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/pidf.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/mwi.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/publish.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/errno.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/xpidf.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub_msg.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_msg.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/config.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/types.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_sock.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_session.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/nat_detect.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_strans.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_session.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_sock.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/errno.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_config.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_session.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_transaction.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_auth.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opencore_amr.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opus.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_sdp_match.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ffmpeg_vid_codecs.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/speex.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/passthrough.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h.in
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/types.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/silk.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ilbc.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/gsm.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221_sdp_match.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g722.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/bcg729.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h264_packetizer.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h263_packetizer.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_helper.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/audio_codecs.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ipp_codecs.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/l16.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/vid_toolbox.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/openh264.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_console.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_bitwise.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/http_client.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/base64.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/config.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/types.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_imp.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/md5.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns_server.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_md5.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/getopt.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli.h
#12 20.14 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_uint.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/xml.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/json.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/resolver.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_sha1.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_telnet.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/srv_resolver.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/pcap.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/sha1.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/errno.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/stun_simple.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/crc32.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/string.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_ver.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_def.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_api.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_app_def.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_100rel.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_inv.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_xfer.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_regc.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_replaces.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_timer.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/config.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/opengl_dev.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/errno.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev_imp.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/avi_dev.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/config.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev_imp.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/errno.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiotest.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_module.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_types.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_tel_uri.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_event.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_util.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tcp.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_loop.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_msg.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_private.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_endpoint.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tls.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_multipart.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_parser.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h.in
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_msg.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_uri.h
#12 20.15 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_ua_layer.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transaction.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_udp.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/print_util.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_errno.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_dialog.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_parser.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_config.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_aka.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_resolve.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua_internal.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_multistream.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_types.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_defines.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_port.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/circbuf.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/conference.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/resample.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/endpoint.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_playlist.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/bidirectional.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_tee.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/port.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/symbian_sound_aps.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_srtp.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/delaybuf.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stereo.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h.in
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp_xr.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/event.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/types.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/tonegen.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/videodev.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi_stream.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/null_port.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtp.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/audiodev.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/silencedet.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/frame.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_loop.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/converter.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wsola.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_port.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/alaw_ulaw.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp_neg.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo_port.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/codec.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/session.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/signatures.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/splitcomb.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec_util.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_ice.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_stream.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/plc.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream_common.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/errno.h
#12 20.16 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/g711.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wave.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/doxygen.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/format.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound_port.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/jbuf.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/clock.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_adapter_sample.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/master_port.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/mem_port.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_udp.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ip_helper.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_io.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ssl_sock.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_select.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/types.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/limits.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site_sample.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/lock.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/os.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/guid.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/fifobuf.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_i.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list_i.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/except.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_access.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/timer.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/unicode.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rbtree.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/activesock.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/log.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ctype.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_qos.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/array.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string_i.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rand.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/addr_resolv.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/math.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/errno.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ioqueue.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/doxygen.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/assert.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/hash.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_alt.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_buf.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/time.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_sunos.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_m68k.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/malloc.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_msvc.h
#12 20.17 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_armv4.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux_kernel.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/limits.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32_wince.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_armcc.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_powerpc.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_rtems.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/high_precision.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_codew.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcce.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_x86_64.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h.in
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/setjmp.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_darwinos.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winuwp.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdfileio.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_alpha.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/ctype.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_mwcc.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_symbian.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/rand.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/errno.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdarg.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/size_t.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h.in
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_i386.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/assert.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcc.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/socket.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winphone8.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_palmos.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/string.h
#12 20.18 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_sparc.h
#12 20.30 .../node_modules/react-native-pjsip postinstall: Done
#12 22.45 
#12 22.45 dependencies:
#12 22.45 + @expo/vector-icons 15.0.3
#12 22.45 + @react-native-async-storage/async-storage 2.2.0
#12 22.45 + @react-navigation/bottom-tabs 7.8.12
#12 22.45 + @react-navigation/elements 2.9.2
#12 22.45 + @react-navigation/native 7.1.25
#12 22.45 + @tanstack/react-query 5.90.12
#12 22.45 + @trpc/client 11.7.2
#12 22.45 + @trpc/react-query 11.7.2
#12 22.45 + @trpc/server 11.7.2
#12 22.45 + @types/pg 8.20.0
#12 22.45 + axios 1.13.2
#12 22.45 + clsx 2.1.1
#12 22.45 + cookie 1.1.1
#12 22.45 + dotenv 16.6.1
#12 22.45 + drizzle-orm 0.44.7
#12 22.45 + expo 54.0.29
#12 22.45 + expo-audio 1.1.0
#12 22.45 + expo-build-properties 1.0.10
#12 22.45 + expo-constants 18.0.12
#12 22.45 + expo-dev-client 6.0.21
#12 22.45 + expo-font 14.0.10
#12 22.45 + expo-haptics 15.0.8
#12 22.45 + expo-image 3.0.11
#12 22.45 + expo-keep-awake 15.0.8
#12 22.45 + expo-linking 8.0.10
#12 22.45 + expo-notifications 0.32.15
#12 22.45 + expo-router 6.0.19
#12 22.45 + expo-secure-store 15.0.8
#12 22.45 + expo-splash-screen 31.0.12
#12 22.45 + expo-status-bar 3.0.9
#12 22.45 + expo-symbols 1.0.8
#12 22.45 + expo-system-ui 6.0.9
#12 22.45 + expo-video 3.0.15
#12 22.45 + expo-web-browser 15.0.10
#12 22.45 + express 4.22.1
#12 22.45 + google-auth-library 10.6.2
#12 22.45 + ioredis 5.10.1
#12 22.45 + jose 6.1.0
#12 22.45 + mysql2 3.16.0
#12 22.45 + nativewind 4.2.1
#12 22.45 + pg 8.20.0
#12 22.45 + react 19.1.0
#12 22.45 + react-dom 19.1.0
#12 22.45 + react-native 0.81.5
#12 22.45 + react-native-callkeep 4.3.16
#12 22.45 + react-native-gesture-handler 2.28.0
#12 22.45 + react-native-pjsip 2.7.4
#12 22.45 + react-native-reanimated 4.1.6
#12 22.45 + react-native-safe-area-context 5.6.2
#12 22.45 + react-native-screens 4.16.0
#12 22.45 + react-native-svg 15.12.1
#12 22.45 + react-native-web 0.21.2
#12 22.45 + react-native-worklets 0.5.1
#12 22.45 + superjson 1.13.3
#12 22.45 + tailwind-merge 2.6.0
#12 22.45 + zod 4.2.1
#12 22.45 + zustand 5.0.12
#12 22.45 
#12 22.45 devDependencies:
#12 22.45 + @config-plugins/react-native-callkeep 12.0.0
#12 22.45 + @expo/ngrok 4.1.3
#12 22.45 + @types/cookie 0.6.0
#12 22.45 + @types/express 4.17.25
#12 22.45 + @types/node 22.19.3
#12 22.45 + @types/qrcode 1.5.6
#12 22.45 + @types/react 19.1.17
#12 22.45 + concurrently 9.2.1
#12 22.45 + cross-env 7.0.3
#12 22.45 + drizzle-kit 0.31.8
#12 22.45 + esbuild 0.25.12
#12 22.45 + eslint 9.39.2
#12 22.45 + eslint-config-expo 10.0.0
#12 22.45 + prettier 3.7.4
#12 22.45 + qrcode 1.5.4
#12 22.45 + tailwindcss 3.4.19
#12 22.45 + tsx 4.21.0
#12 22.45 + typescript 5.9.3
#12 22.45 + vitest 2.1.9
#12 22.45 
#12 22.60 
#12 22.60 > phone11-mobile@1.0.0 postinstall /app
#12 22.60 > node scripts/patch-react-native-pjsip.mjs && node scripts/fix-pjsip-podspec-ruby.mjs
#12 22.60 
#12 22.66 [phone11-pjsip-patch] Wrote iOS podspec: /app/node_modules/react-native-pjsip/react-native-pjsip.podspec; vendored_frameworks=ios/VialerPJSIP.framework
#12 22.67 [phone11-pjsip-patch] Wrote iOS PjSipModule legacy bridge export: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#12 22.67 [phone11-pjsip-patch] Verified iOS PjSipModule legacy bridge export: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#12 22.68 [phone11-pjsip-patch] Wrote iOS registration payload patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipAccount.m
#12 22.70 [phone11-pjsip-patch] Wrote iOS audio callback patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#12 22.70 [phone11-pjsip-patch] Wrote iOS safe string patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipUtil.m
#12 22.71 [phone11-pjsip-patch] Wrote iOS media bridge patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipCall.m
#12 22.80 [phone11-pjsip-patch] Patched react-native-pjsip iOS/Android native config.
#12 22.85 [phone11-pjsip-podspec-ruby] Podspec Ruby quoting already valid.
#12 22.85 Done in 22.5s
#12 DONE 25.4s

#13 [backend deps 7/8] RUN pnpm install --frozen-lockfile --prod
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./ios/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libopenh264.so
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libpjsua2.so
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libopenh264.so
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libpjsua2.so
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libopenh264.so
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libpjsua2.so
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libopenh264.so
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libpjsua2.so
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCameraInfo.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCamera.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentObject.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnSelectAccountParam.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTransaction.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStateParam.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_name_type.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamInfo.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IpChangeParam.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ipv6_use.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingSubscribeParam.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportParam.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtp.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjrpid_activity.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_log_decoration.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/WindowHandle.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamCreatedParam.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_flags_e.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfo.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_packing.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_event_type.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_destroy_flag.java
#13 17.76 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxData.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_event_id_e.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_stun_use.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_cap.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_cred_data_type.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendTypingIndicationParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_status_code.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_use.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSendRequestParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_media_status.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRxOfferParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamStat.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayer.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDesc.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallOpParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogConfig.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pjmedia_vid_dev_hwnd_type.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_unsigned_char.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_sip_timer_use.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVector.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnBuddyEvSubStateParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsConfig.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfoVector.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JsonDocument.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SrtpCrypto.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfoVector.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SdpSession.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_bool_t.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountIpChangeConfig.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfoVector.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_dialog_cap_status.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipRxData.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidDevManager.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_mode.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamInfo.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LossType.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaStateParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_vid_strm_op.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_p_void.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertInfo.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RegProgressParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_dir.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountRegConfig.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_vid_req_keyframe_method.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayerInfo.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/FindBuddyMatch.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_verify_flag_t.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRedirectedParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEvent.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtpVector.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMwiConfig.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/EpConfig.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxOption.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_wmm_prio.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ip_change_op.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UaConfig.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFmtChangedEvent.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_id.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowInfo.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaTransportInfo.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaEventParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxMsgEvent.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallStateParam.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tp_proto.java
#13 17.77 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountPresConfig.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTsxStateParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageStatusParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_type.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PendingJob.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_flag.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_params.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2Constants.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_format_id.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_turn_tp_type.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPart.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEventSrc.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_invalid_id_const_.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Media.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnDtmfDigitParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyVector.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountCallConfig.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMediaConfig.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowHandle.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentDocument.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogEntry.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportSrtpParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresenceStatus.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaRecorder.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_desc.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountNatConfig.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_evsub_state.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfoVector.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaConfig.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfoVector.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTxOfferParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindow.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeaderVector.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimeVal.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Account.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyInfo.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_ssize_t.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneGenerator.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendInstantMessageParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaCoordinate.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplacedParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTransportStateParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit_map.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_crypto_option.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfo.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RxMsgEvent.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Call.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapDigit.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallSdpCreatedParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxErrorEvent.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaVector.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallVidSetStreamParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ConfPortInfo.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_file_access.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_player_option.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEventBody.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamDestroyedParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_nat64_opt.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_id.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidCodecParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpSdes.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTimerParam.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_tsx_state_e.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_redirect_op.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMedia.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_role_e.java
#13 17.78 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeader.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStat.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_hold_type.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_std_index.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_sock_proto.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingCallParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTypingIndicationParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_stream_rc_method.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudDevManager.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Endpoint.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_writer_option.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIpChangeProgressParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_state.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPartVector.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_type.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreview.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferStatusParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_orient.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEvent.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_flag.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_stun_nat_type.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaSize.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapVector.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVideo.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitVector.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MathStat.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportInfo.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_create_media_transport_flag.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStartedParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallInfo.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountSipConfig.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresNotifyParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMediaType.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplaceRequestParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_ssl_method.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cipher.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreviewOpParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertName.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UserEvent.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamSetting.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatCheckStunServersCompleteParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_hdr_e.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfo.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsInfo.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatAudio.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEvent.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_med_tp_st.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigit.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_type_e.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_inv_state.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnMwiInfoParam.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Buddy.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStreamStat.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportConfig.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimerEvent.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JbufState.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountConfig.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IntVector.java
#13 17.79 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_route.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyConfig.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormat.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogWriter.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Error.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_100rel_use.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ContainerNode.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_buddy_status.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2JNI.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_std__vectorT_pj__MediaFormat_t.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfo.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountInfo.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_state.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoSwitchParam.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSetting.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Version.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SslCertName_t.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfo.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_void.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_constants_.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferRequestParam.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaTransportStateParam.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StringVector.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_cap.java
#13 17.80 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SrtpCrypto_t.java
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEventData.java
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountVideoConfig.java
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatDetectionCompleteParam.java
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDescVector.java
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/VialerPJSIP
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_simple.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/ZsrtpCWrapper.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2.hpp
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/transport_zrtp.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_videodev.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_auth.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_audiodev.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib++.hpp
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_ua.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketGoClear.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheFile.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCodes.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHello.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Decode.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStateClass.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketBase.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecord.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPing.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallback.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheDb.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallbackWrapper.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Encode.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHelloAck.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZRtp.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpCacheDbBackend.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpTextData.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/Base32.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConf2Ack.h
#13 19.37 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordDb.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketError.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCWrapper.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpSdesStream.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpPacket.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketSASrelay.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpUserCallback.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketClearAck.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStates.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpConfigure.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCache.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketRelayAck.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConfirm.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCrc32.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketDHPart.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordFile.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketErrorAck.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPingAck.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/EmojiBase32.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketCommit.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/json.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/persistent.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/doxygen.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/config.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/siptypes.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/account.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/endpoint.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/call.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/presence.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/media.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/types.hpp
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem2.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl3.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ossl_typ.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dtls1.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/err.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bn.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/blowfish.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cms.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/engine.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf_api.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1_mac.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_x86_64.h
#13 19.38 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/kssl.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7s.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/sha.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/symhacks.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_i386.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bio.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc2.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dh.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui_compat.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509v3.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl23.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md5.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509_vfy.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/txt_db.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/safestack.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdsa.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/objects.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs12.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/crypto.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslv.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs7.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/obj_mac.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/buffer.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srp.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/camellia.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_arm64.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/evp.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/e_os2.h
#13 19.39 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md4.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/hmac.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/aes.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/comp.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cast.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc4.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/stack.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ocsp.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ec.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdh.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rand.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ts.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pqueue.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dso.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/seed.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/modes.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl2.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rsa.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/krb5_asn.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des_old.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ripemd.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/whrlpool.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/tls1.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/mdc2.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dsa.h
#13 19.40 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srtp.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1t.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cmac.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ebcdic.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/idea.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/lhash.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/hash.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/lock.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/proactor.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/file.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/list.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/pool.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/timer.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/string.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/tree.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/scanner.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/types.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/os.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/sock.hpp
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/types.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/presence.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/iscomposing.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/rpid.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/pidf.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/mwi.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/publish.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/errno.h
#13 19.41 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/xpidf.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub_msg.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_msg.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/config.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/types.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_sock.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_session.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/nat_detect.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_strans.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_session.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_sock.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/errno.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_config.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_session.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_transaction.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_auth.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opencore_amr.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opus.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_sdp_match.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ffmpeg_vid_codecs.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/speex.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/passthrough.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h.in
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/types.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/silk.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ilbc.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/gsm.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221_sdp_match.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g722.h
#13 19.42 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/bcg729.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h264_packetizer.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h263_packetizer.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_helper.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/audio_codecs.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ipp_codecs.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/l16.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/vid_toolbox.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/openh264.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_console.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_bitwise.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/http_client.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/base64.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/config.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/types.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_imp.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/md5.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns_server.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_md5.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/getopt.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_uint.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/xml.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/json.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/resolver.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_sha1.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_telnet.h
#13 19.43 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/srv_resolver.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/pcap.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/sha1.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/errno.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/stun_simple.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/crc32.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/string.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_ver.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_def.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_api.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_app_def.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_100rel.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_inv.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_xfer.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_regc.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_replaces.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_timer.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/config.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/opengl_dev.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/errno.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev_imp.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/avi_dev.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/config.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev_imp.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/errno.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiotest.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_module.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_types.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_tel_uri.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_event.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_util.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tcp.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_loop.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_msg.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_private.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_endpoint.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tls.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_multipart.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_parser.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h.in
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_msg.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_uri.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_ua_layer.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transaction.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_udp.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/print_util.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_errno.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_dialog.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_parser.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_config.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_aka.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_resolve.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua_internal.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_multistream.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_types.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_defines.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_port.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/circbuf.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/conference.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/resample.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/endpoint.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_playlist.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/bidirectional.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_tee.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/port.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/symbian_sound_aps.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_srtp.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/delaybuf.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stereo.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h.in
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp_xr.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/event.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/types.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/tonegen.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/videodev.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi_stream.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/null_port.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtp.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/audiodev.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/silencedet.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/frame.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_loop.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/converter.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wsola.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_port.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/alaw_ulaw.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp_neg.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo_port.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/codec.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/session.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/signatures.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/splitcomb.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec_util.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_ice.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_stream.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/plc.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream_common.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/errno.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/g711.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wave.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/doxygen.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/format.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound_port.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/jbuf.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/clock.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_adapter_sample.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/master_port.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/mem_port.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_udp.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ip_helper.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_io.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ssl_sock.h
#13 19.44 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_select.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/types.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/limits.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site_sample.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/lock.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/os.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/guid.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/fifobuf.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_i.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list_i.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/except.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_access.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/timer.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/unicode.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rbtree.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/activesock.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/log.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ctype.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_qos.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/array.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string_i.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rand.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/addr_resolv.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/math.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/errno.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ioqueue.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/doxygen.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/assert.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/hash.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_alt.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_buf.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/time.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_sunos.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_m68k.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/malloc.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_msvc.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_armv4.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux_kernel.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/limits.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32_wince.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_armcc.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_powerpc.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_rtems.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/high_precision.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_codew.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcce.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_x86_64.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h.in
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/setjmp.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_darwinos.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winuwp.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdfileio.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_alpha.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/ctype.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_mwcc.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_symbian.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/rand.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/errno.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdarg.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/size_t.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h.in
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_i386.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/assert.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcc.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/socket.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winphone8.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_palmos.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/string.h
#13 19.45 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_sparc.h
#13 19.46 .../node_modules/react-native-pjsip postinstall: Done
#13 25.87 
#13 25.87 dependencies:
#13 25.87 + @expo/vector-icons 15.0.3
#13 25.87 + @react-native-async-storage/async-storage 2.2.0
#13 25.87 + @react-navigation/bottom-tabs 7.8.12
#13 25.87 + @react-navigation/elements 2.9.2
#13 25.87 + @react-navigation/native 7.1.25
#13 25.87 + @tanstack/react-query 5.90.12
#13 25.87 + @trpc/client 11.7.2
#13 25.87 + @trpc/react-query 11.7.2
#13 25.87 + @trpc/server 11.7.2
#13 25.87 + @types/pg 8.20.0
#13 25.87 + axios 1.13.2
#13 25.87 + clsx 2.1.1
#13 25.87 + cookie 1.1.1
#13 25.87 + dotenv 16.6.1
#13 25.87 + drizzle-orm 0.44.7
#13 25.87 + expo 54.0.29
#13 25.87 + expo-audio 1.1.0
#13 25.87 + expo-build-properties 1.0.10
#13 25.87 + expo-constants 18.0.12
#13 25.87 + expo-dev-client 6.0.21
#13 25.87 + expo-font 14.0.10
#13 25.87 + expo-haptics 15.0.8
#13 25.87 + expo-image 3.0.11
#13 25.87 + expo-keep-awake 15.0.8
#13 25.87 + expo-linking 8.0.10
#13 25.87 + expo-notifications 0.32.15
#13 25.87 + expo-router 6.0.19
#13 25.87 + expo-secure-store 15.0.8
#13 25.87 + expo-splash-screen 31.0.12
#13 25.87 + expo-status-bar 3.0.9
#13 25.87 + expo-symbols 1.0.8
#13 25.87 + expo-system-ui 6.0.9
#13 25.87 + expo-video 3.0.15
#13 25.87 + expo-web-browser 15.0.10
#13 25.87 + express 4.22.1
#13 25.87 + google-auth-library 10.6.2
#13 25.87 + ioredis 5.10.1
#13 25.87 + jose 6.1.0
#13 25.87 + mysql2 3.16.0
#13 25.87 + nativewind 4.2.1
#13 25.87 + pg 8.20.0
#13 25.87 + react 19.1.0
#13 25.87 + react-dom 19.1.0
#13 25.87 + react-native 0.81.5
#13 25.87 + react-native-callkeep 4.3.16
#13 25.87 + react-native-gesture-handler 2.28.0
#13 25.87 + react-native-pjsip 2.7.4
#13 25.87 + react-native-reanimated 4.1.6
#13 25.87 + react-native-safe-area-context 5.6.2
#13 25.87 + react-native-screens 4.16.0
#13 25.87 + react-native-svg 15.12.1
#13 25.87 + react-native-web 0.21.2
#13 25.87 + react-native-worklets 0.5.1
#13 25.87 + superjson 1.13.3
#13 25.87 + tailwind-merge 2.6.0
#13 25.87 + zod 4.2.1
#13 25.87 + zustand 5.0.12
#13 25.87 
#13 25.87 devDependencies: skipped
#13 25.87 
#13 25.90 
#13 25.90 > phone11-mobile@1.0.0 postinstall /app
#13 25.90 > node scripts/patch-react-native-pjsip.mjs && node scripts/fix-pjsip-podspec-ruby.mjs
#13 25.90 
#13 25.98 [phone11-pjsip-patch] Wrote iOS podspec: /app/node_modules/react-native-pjsip/react-native-pjsip.podspec; vendored_frameworks=ios/VialerPJSIP.framework
#13 25.98 [phone11-pjsip-patch] Wrote iOS PjSipModule legacy bridge export: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#13 25.98 [phone11-pjsip-patch] Verified iOS PjSipModule legacy bridge export: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#13 25.98 [phone11-pjsip-patch] Wrote iOS registration payload patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipAccount.m
#13 25.98 [phone11-pjsip-patch] Wrote iOS audio callback patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipModule.m
#13 25.98 [phone11-pjsip-patch] Wrote iOS safe string patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipUtil.m
#13 25.98 [phone11-pjsip-patch] Wrote iOS media bridge patch: /app/node_modules/react-native-pjsip/ios/RTCPjSip/PjSipCall.m
#13 26.15 [phone11-pjsip-patch] Patched react-native-pjsip iOS/Android native config.
#13 26.20 [phone11-pjsip-podspec-ruby] Podspec Ruby quoting already valid.
#13 26.20 Done in 25.9s
#13 DONE 26.8s

#14 [backend builder  8/13] COPY server/ ./server/
#14 DONE 1.5s

#15 [backend builder  9/13] COPY shared/ ./shared/
#15 DONE 0.6s

#16 [backend deps 8/8] RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
#16 ...

#17 [backend builder 10/13] COPY drizzle/ ./drizzle/
#17 DONE 0.1s

#18 [backend builder 11/13] COPY drizzle.config.ts ./
#18 DONE 0.1s

#19 [backend builder 12/13] COPY tsconfig.json ./
#19 DONE 0.0s

#20 [backend builder 13/13] RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
#20 ...

#16 [backend deps 8/8] RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
#16 DONE 1.3s

#20 [backend builder 13/13] RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
#20 0.721 
#20 0.721   dist/index.mjs  192.9kb
#20 0.721 
#20 0.721 ⚡ Done in 18ms
#20 DONE 0.8s

#21 [backend production 3/7] RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone &&     mkdir -p /var/lib/phone11/recordings /var/lib/phone11/voicemail &&     chown -R cloudphone:cloudphone /var/lib/phone11
#21 CACHED

#22 [backend production 4/7] COPY --from=deps /app/node_modules ./node_modules
#22 DONE 10.7s

#23 [backend production 5/7] COPY --from=builder /app/dist ./dist
#23 DONE 0.8s

#24 [backend production 6/7] COPY --from=builder /app/drizzle ./drizzle
#24 DONE 0.1s

#25 [backend production 7/7] COPY package.json ./
#25 DONE 0.0s

#26 [backend] exporting to image
#26 exporting layers
#26 exporting layers 34.4s done
#26 exporting manifest sha256:a7687535a85560f23d5a508de549235512ff7700cd07cd3b76e06ee155e566d5 done
#26 exporting config sha256:f0521c8b9608eec32fd01c959ea7fc02a431a29f07281b52c1fec7c08441a40b done
#26 exporting attestation manifest sha256:b101378dab0e87760c4b624abee2c36d9c404bea96d37d9f816110d77912b015 0.0s done
#26 exporting manifest list sha256:c5a006aa27c283a7a61455983c75e258dfe8cc718f9a699666af7dbf0d87701b done
#26 naming to docker.io/library/cloudphone11-prod-backend:latest done
#26 unpacking to docker.io/library/cloudphone11-prod-backend:latest
#26 unpacking to docker.io/library/cloudphone11-prod-backend:latest 8.8s done
#26 DONE 43.3s

#27 [backend] resolving provenance for metadata file
#27 DONE 0.0s
 backend  Built
 Container cp11-postgres  Running
 Container cp11-redis  Running
 Container cp11-backend  Recreate
 Container cp11-backend  Recreated
 Container cp11-postgres  Waiting
 Container cp11-redis  Waiting
 Container cp11-redis  Healthy
 Container cp11-postgres  Healthy
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
{"ok":true,"timestamp":1779843792192,"build":"138bc625311b4a537524c718768e07eaf417070d","service":"phone11-backend"}
--- Verifying public api.phone11.ai route ---
Public health: {"ok":true,"timestamp":1779843792383,"build":"7b0c678eeff3893ce53c964f17a88d76327299ab","service":"phone11-backend"}
ERROR: public API answered, but it is not serving this deploy commit.
Expected build marker: 138bc625311b4a537524c718768e07eaf417070d
--- Public API route diagnostics ---
DNS for api.phone11.ai:
43.209.112.208  STREAM api.phone11.ai
43.209.112.208  DGRAM  
43.209.112.208  RAW    
Listening ports 80/443/3000/3001:
LISTEN 0      511          0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=1309581,fd=5),("nginx",pid=1309580,fd=5),("nginx",pid=1309579,fd=5),("nginx",pid=1309578,fd=5),("nginx",pid=1309575,fd=5))
LISTEN 0      4096       127.0.0.1:3000       0.0.0.0:*    users:(("docker-proxy",pid=224147,fd=7))                                                                                                      
LISTEN 0      511                *:3001             *:*    users:(("node",pid=1140499,fd=21))                                                                                                            
Docker containers:
cp11-backend c5a006aa27c2 127.0.0.1:3000->3000/tcp
p11-kamailio ghcr.io/kamailio/kamailio:5.8.4-bookworm 
p11-rtpengine drachtio/rtpengine:latest 
cp11-redis redis:7-alpine 6379/tcp
cp11-postgres postgres:16-alpine 127.0.0.1:5432->5432/tcp
p11-freeswitch safarov/freeswitch:latest 
p11-redis redis:7-alpine 
Direct backend health:
{"ok":true,"timestamp":1779843792537,"build":"138bc625311b4a537524c718768e07eaf417070d","service":"phone11-backend"}
Local HTTP Host-route health:
{"ok":true,"timestamp":1779843792563,"build":"138bc625311b4a537524c718768e07eaf417070d","service":"phone11-backend"}
Local HTTPS Host-route health:

Nginx proxy snippets:
curl: (7) Failed to connect to api.phone11.ai port 443 after 0 ms: Couldn't connect to server

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
```
