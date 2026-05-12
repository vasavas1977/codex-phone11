# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T16:16:33+00:00
- Workflow commit: 91527f9ceb5152771322f5a6a3d08cd855889394
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.210.122.111
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 mobile branch backend redeploy ===
Host: ip-10-0-1-69
Time: 2026-05-12T16:16:00+00:00
GitHub SHA: 91527f9ceb5152771322f5a6a3d08cd855889394
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
From https://github.com/vasavas1977/codex-phone11
 * branch            91527f9ceb5152771322f5a6a3d08cd855889394 -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  7bd3313 Redeploy mobile branch backend after Docker fix

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> 7bd3313

HEAD is now at 91527f9 Trigger EC2 redeploy after curl Docker fix
--- Aligning Postgres role password ---
ALTER ROLE
--- Rebuilding backend with patched Dockerfile and DB config ---
time="2026-05-12T16:16:02Z" level=warning msg="Docker Compose is configured to build using Bake, but buildx isn't installed"
#0 building with "default" instance using docker driver

#1 [backend internal] load build definition from Dockerfile
#1 transferring dockerfile: 2.31kB done
#1 DONE 0.0s

#2 [backend internal] load metadata for docker.io/library/node:22-alpine
#2 DONE 1.2s

#3 [backend internal] load .dockerignore
#3 transferring context: 2B done
#3 DONE 0.0s

#4 [backend internal] load build context
#4 transferring context: 2.61kB done
#4 DONE 0.0s

#5 [backend builder  1/12] FROM docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
#5 resolve docker.io/library/node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f 0.0s done
#5 DONE 0.0s

#6 [backend builder  2/12] WORKDIR /app
#6 CACHED

#7 [backend builder  3/12] RUN apk add --no-cache bash curl ca-certificates
#7 1.563 ( 1/15) Installing ncurses-terminfo-base (6.5_p20251123-r0)
#7 1.663 ( 2/15) Installing libncursesw (6.5_p20251123-r0)
#7 1.765 ( 3/15) Installing readline (8.3.1-r0)
#7 1.866 ( 4/15) Installing bash (5.3.3-r1)
#7 1.978   Executing bash-5.3.3-r1.post-install
#7 1.982 ( 5/15) Installing ca-certificates (20260413-r0)
#7 2.095 ( 6/15) Installing brotli-libs (1.2.0-r0)
#7 2.203 ( 7/15) Installing c-ares (1.34.6-r0)
#7 2.301 ( 8/15) Installing libunistring (1.4.1-r0)
#7 2.417 ( 9/15) Installing libidn2 (2.3.8-r0)
#7 2.515 (10/15) Installing nghttp2-libs (1.69.0-r0)
#7 2.613 (11/15) Installing nghttp3 (1.13.1-r0)
#7 2.710 (12/15) Installing libpsl (0.21.5-r3)
#7 2.807 (13/15) Installing zstd-libs (1.5.7-r2)
#7 2.913 (14/15) Installing libcurl (8.17.0-r1)
#7 3.018 (15/15) Installing curl (8.17.0-r1)
#7 3.119 Executing busybox-1.37.0-r30.trigger
#7 3.124 Executing ca-certificates-20260413-r0.trigger
#7 3.151 OK: 18.3 MiB in 33 packages
#7 DONE 3.3s

#8 [backend builder  4/12] RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
#8 0.299 Preparing pnpm@9.12.0 for immediate activation...
#8 DONE 1.3s

#9 [backend builder  5/12] COPY package.json pnpm-lock.yaml ./
#9 DONE 0.1s

#10 [backend deps 6/6] RUN pnpm install --frozen-lockfile --prod
#10 0.799 Lockfile is up to date, resolution step is skipped
#10 0.907 Progress: resolved 1, reused 0, downloaded 0, added 0
#10 1.167 Packages: +899
#10 1.167 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#10 1.591 
#10 1.591    ╭──────────────────────────────────────────────────────────────────╮
#10 1.591    │                                                                  │
#10 1.591    │                Update available! 9.12.0 → 11.1.1.                │
#10 1.591    │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.1.1   │
#10 1.591    │         Run "corepack install -g pnpm@11.1.1" to update.         │
#10 1.591    │                                                                  │
#10 1.591    │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
#10 1.591    │                                                                  │
#10 1.591    ╰──────────────────────────────────────────────────────────────────╯
#10 1.591 
#10 1.917 Progress: resolved 899, reused 0, downloaded 37, added 31
#10 2.911 Progress: resolved 899, reused 0, downloaded 159, added 159
#10 3.912 Progress: resolved 899, reused 0, downloaded 326, added 325
#10 4.913 Progress: resolved 899, reused 0, downloaded 464, added 463
#10 5.914 Progress: resolved 899, reused 0, downloaded 522, added 512
#10 6.914 Progress: resolved 899, reused 0, downloaded 609, added 608
#10 7.914 Progress: resolved 899, reused 0, downloaded 646, added 637
#10 8.914 Progress: resolved 899, reused 0, downloaded 691, added 682
#10 9.914 Progress: resolved 899, reused 0, downloaded 710, added 697
#10 ...

#11 [backend builder  6/12] RUN pnpm install --frozen-lockfile
#11 0.808 Lockfile is up to date, resolution step is skipped
#11 0.959 Progress: resolved 1, reused 0, downloaded 0, added 0
#11 1.260 Packages: +1158
#11 1.260 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#11 1.677 
#11 1.677    ╭──────────────────────────────────────────────────────────────────╮
#11 1.677    │                                                                  │
#11 1.677    │                Update available! 9.12.0 → 11.1.1.                │
#11 1.677    │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v11.1.1   │
#11 1.677    │         Run "corepack install -g pnpm@11.1.1" to update.         │
#11 1.677    │                                                                  │
#11 1.677    │         Follow @pnpmjs for updates: https://x.com/pnpmjs         │
#11 1.677    │                                                                  │
#11 1.677    ╰──────────────────────────────────────────────────────────────────╯
#11 1.677 
#11 1.964 Progress: resolved 1158, reused 0, downloaded 22, added 15
#11 2.960 Progress: resolved 1158, reused 0, downloaded 160, added 158
#11 3.961 Progress: resolved 1158, reused 0, downloaded 336, added 330
#11 4.962 Progress: resolved 1158, reused 0, downloaded 469, added 469
#11 5.964 Progress: resolved 1158, reused 0, downloaded 518, added 514
#11 6.965 Progress: resolved 1158, reused 0, downloaded 561, added 550
#11 7.968 Progress: resolved 1158, reused 0, downloaded 643, added 633
#11 8.966 Progress: resolved 1158, reused 0, downloaded 693, added 682
#11 9.967 Progress: resolved 1158, reused 0, downloaded 713, added 698
#11 ...

#10 [backend deps 6/6] RUN pnpm install --frozen-lockfile --prod
#10 10.92 Progress: resolved 899, reused 0, downloaded 793, added 782
#10 11.92 Progress: resolved 899, reused 0, downloaded 846, added 836
#10 12.92 Progress: resolved 899, reused 0, downloaded 897, added 897
#10 13.51 Progress: resolved 899, reused 0, downloaded 899, added 899, done
#10 14.24 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
#10 14.24 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
#10 14.51 .../node_modules/react-native-pjsip postinstall:   % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
#10 14.51 .../node_modules/react-native-pjsip postinstall:                                  Dload  Upload   Total   Spent    Left  Speed
#10 14.63 .../esbuild@0.27.2/node_modules/esbuild postinstall: Done
#10 15.01 .../node_modules/react-native-pjsip postinstall:   0     0   0     0   0     0     0     0  --:--:-- --:--:-- --:--:--     0
#10 15.01 .../node_modules/react-native-pjsip postinstall:   0     0   0     0   0     0     0     0  --:--:-- --:--:-- --:--:--     0
#10 16.53 .../node_modules/react-native-pjsip postinstall:   3 74142k   3  2764k   0     0  3114k     0   0:00:23 --:--:--  0:00:23  3114k
#10 17.54 .../node_modules/react-native-pjsip postinstall:  41 74142k  41 30780k   0     0 15174k     0   0:00:04  0:00:02  0:00:02 24575k
#10 17.84 .../node_modules/react-native-pjsip postinstall:  82 74142k  82 61440k   0     0 20238k     0   0:00:03  0:00:03 --:--:-- 27316k
#10 17.84 .../node_modules/react-native-pjsip postinstall: 100 74142k 100 74142k   0     0 22212k     0   0:00:03  0:00:03 --:--:-- 29133k
#10 17.85 .../node_modules/react-native-pjsip postinstall: ./
#10 18.24 .../node_modules/react-native-pjsip postinstall: ./ios/
#10 18.24 .../node_modules/react-native-pjsip postinstall: ./android/
#10 18.24 .../node_modules/react-native-pjsip postinstall: ./android/src/
#10 18.24 .../node_modules/react-native-pjsip postinstall: ./android/src/main/
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libopenh264.so
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libpjsua2.so
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libopenh264.so
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libpjsua2.so
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libopenh264.so
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libpjsua2.so
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libopenh264.so
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libpjsua2.so
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCameraInfo.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCamera.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentObject.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnSelectAccountParam.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTransaction.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStateParam.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_name_type.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamInfo.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IpChangeParam.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ipv6_use.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingSubscribeParam.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportParam.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtp.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjrpid_activity.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_log_decoration.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/WindowHandle.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamCreatedParam.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_flags_e.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfo.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_packing.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_event_type.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_destroy_flag.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxData.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_event_id_e.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_stun_use.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_cap.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_cred_data_type.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendTypingIndicationParam.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_status_code.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_use.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSendRequestParam.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_media_status.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRxOfferParam.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamStat.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayer.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDesc.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallOpParam.java
#10 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogConfig.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pjmedia_vid_dev_hwnd_type.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_unsigned_char.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_sip_timer_use.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVector.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnBuddyEvSubStateParam.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsConfig.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfoVector.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JsonDocument.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SrtpCrypto.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfoVector.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SdpSession.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_bool_t.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountIpChangeConfig.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfoVector.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_dialog_cap_status.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipRxData.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidDevManager.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_mode.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamInfo.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LossType.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaStateParam.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_vid_strm_op.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_p_void.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertInfo.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RegProgressParam.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_dir.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountRegConfig.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_vid_req_keyframe_method.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayerInfo.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/FindBuddyMatch.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageParam.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_verify_flag_t.java
#10 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRedirectedParam.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEvent.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtpVector.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMwiConfig.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/EpConfig.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxOption.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_wmm_prio.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ip_change_op.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UaConfig.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFmtChangedEvent.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_id.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowInfo.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaTransportInfo.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaEventParam.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxMsgEvent.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallStateParam.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tp_proto.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountPresConfig.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTsxStateParam.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageStatusParam.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_type.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PendingJob.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_flag.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_params.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2Constants.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_format_id.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_turn_tp_type.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPart.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEventSrc.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_invalid_id_const_.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Media.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnDtmfDigitParam.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyVector.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountCallConfig.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMediaConfig.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowHandle.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentDocument.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogEntry.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportSrtpParam.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresenceStatus.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaRecorder.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_desc.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountNatConfig.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_evsub_state.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfoVector.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaConfig.java
#10 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfoVector.java
#10 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTxOfferParam.java
#10 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindow.java
#10 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeaderVector.java
#10 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimeVal.java
#10 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Account.java
#10 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyInfo.java
#10 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_ssize_t.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneGenerator.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendInstantMessageParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaCoordinate.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplacedParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTransportStateParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit_map.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_crypto_option.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfo.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RxMsgEvent.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Call.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapDigit.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallSdpCreatedParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxErrorEvent.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaVector.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallVidSetStreamParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ConfPortInfo.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_file_access.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_player_option.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEventBody.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamDestroyedParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_nat64_opt.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_id.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidCodecParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpSdes.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTimerParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_tsx_state_e.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_redirect_op.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMedia.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_role_e.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeader.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStat.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_hold_type.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_std_index.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_sock_proto.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingCallParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTypingIndicationParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_stream_rc_method.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudDevManager.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Endpoint.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_writer_option.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIpChangeProgressParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_state.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPartVector.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_type.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreview.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferStatusParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_orient.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEvent.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_flag.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_stun_nat_type.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaSize.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapVector.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVideo.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitVector.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MathStat.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportInfo.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_create_media_transport_flag.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStartedParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallInfo.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountSipConfig.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresNotifyParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMediaType.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplaceRequestParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_ssl_method.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cipher.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreviewOpParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertName.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UserEvent.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamSetting.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatCheckStunServersCompleteParam.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_hdr_e.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfo.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsInfo.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatAudio.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEvent.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_med_tp_st.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigit.java
#10 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_type_e.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_inv_state.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnMwiInfoParam.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Buddy.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStreamStat.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportConfig.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimerEvent.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JbufState.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountConfig.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IntVector.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_route.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyConfig.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormat.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogWriter.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Error.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_100rel_use.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ContainerNode.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_buddy_status.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2JNI.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_std__vectorT_pj__MediaFormat_t.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfo.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountInfo.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_state.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoSwitchParam.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSetting.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Version.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SslCertName_t.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfo.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_void.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_constants_.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferRequestParam.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaTransportStateParam.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StringVector.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_cap.java
#10 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SrtpCrypto_t.java
#10 19.68 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEventData.java
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountVideoConfig.java
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatDetectionCompleteParam.java
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDescVector.java
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/VialerPJSIP
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_simple.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/ZsrtpCWrapper.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2.hpp
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/transport_zrtp.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_videodev.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_auth.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_audiodev.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib++.hpp
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_ua.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketGoClear.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheFile.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCodes.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHello.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Decode.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStateClass.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketBase.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecord.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPing.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallback.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheDb.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallbackWrapper.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Encode.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHelloAck.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZRtp.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpCacheDbBackend.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpTextData.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/Base32.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConf2Ack.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordDb.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketError.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCWrapper.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpSdesStream.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpPacket.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketSASrelay.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpUserCallback.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketClearAck.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStates.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpConfigure.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCache.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketRelayAck.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConfirm.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCrc32.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketDHPart.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordFile.h
#10 19.69 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketErrorAck.h
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPingAck.h
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/EmojiBase32.h
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketCommit.h
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/json.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/persistent.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/doxygen.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/config.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/siptypes.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/account.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/endpoint.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/call.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/presence.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/media.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/types.hpp
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem2.h
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem.h
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl3.h
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ossl_typ.h
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dtls1.h
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/err.h
#10 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bn.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/blowfish.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cms.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/engine.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf_api.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1_mac.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_x86_64.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/kssl.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7s.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/sha.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/symhacks.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_i386.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bio.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc2.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dh.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui_compat.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509v3.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl23.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md5.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509_vfy.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/txt_db.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/safestack.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdsa.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/objects.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs12.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/crypto.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslv.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs7.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/obj_mac.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/buffer.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srp.h
#10 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/camellia.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_arm64.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/evp.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/e_os2.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md4.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/hmac.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/aes.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/comp.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cast.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc4.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/stack.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ocsp.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ec.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdh.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rand.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ts.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pqueue.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dso.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/seed.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/modes.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl2.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rsa.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/krb5_asn.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des_old.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ripemd.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/whrlpool.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/tls1.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/mdc2.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dsa.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srtp.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1t.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cmac.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ebcdic.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/idea.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/lhash.h
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/hash.hpp
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/lock.hpp
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/proactor.hpp
#10 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/file.hpp
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/list.hpp
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/pool.hpp
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/timer.hpp
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/string.hpp
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/tree.hpp
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/scanner.hpp
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/types.hpp
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/os.hpp
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/sock.hpp
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/types.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/presence.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/iscomposing.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/rpid.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/pidf.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/mwi.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/publish.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/errno.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/xpidf.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub_msg.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_msg.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/config.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/types.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_sock.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_session.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/nat_detect.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_strans.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_session.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_sock.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/errno.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_config.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_session.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_transaction.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_auth.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opencore_amr.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opus.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_sdp_match.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ffmpeg_vid_codecs.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/speex.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/passthrough.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h.in
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config.h
#10 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/types.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/silk.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ilbc.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/gsm.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221_sdp_match.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g722.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/bcg729.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h264_packetizer.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h263_packetizer.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_helper.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/audio_codecs.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ipp_codecs.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/l16.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/vid_toolbox.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/openh264.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_console.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_bitwise.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/http_client.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/base64.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/config.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/types.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_imp.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/md5.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns_server.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_md5.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/getopt.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_uint.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/xml.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/json.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/resolver.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_sha1.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_telnet.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/srv_resolver.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/pcap.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/sha1.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/errno.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/stun_simple.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/crc32.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/string.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_ver.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_def.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_api.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_app_def.h
#10 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_100rel.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_inv.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_xfer.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_regc.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_replaces.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_timer.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/config.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/opengl_dev.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/errno.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev_imp.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/avi_dev.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/config.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev_imp.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/errno.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiotest.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_module.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_types.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_tel_uri.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_event.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_util.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tcp.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_loop.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_msg.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_private.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_endpoint.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tls.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_multipart.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_parser.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h.in
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_msg.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_uri.h
#10 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_ua_layer.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transaction.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_udp.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/print_util.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_errno.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_dialog.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_parser.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_config.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_aka.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_resolve.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua_internal.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_multistream.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_types.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_defines.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_port.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/circbuf.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/conference.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/resample.h
#10 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/endpoint.h
#10 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_playlist.h
#10 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/bidirectional.h
#10 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_tee.h
#10 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/port.h
#10 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec.h
#10 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/symbian_sound_aps.h
#10 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_srtp.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/delaybuf.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stereo.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h.in
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp_xr.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/event.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/types.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/tonegen.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/videodev.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi_stream.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/null_port.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtp.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/audiodev.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/silencedet.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/frame.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_loop.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/converter.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wsola.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_port.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/alaw_ulaw.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp_neg.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo_port.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/codec.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/session.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/signatures.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/splitcomb.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec_util.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_ice.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_stream.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/plc.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream_common.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/errno.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/g711.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wave.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/doxygen.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/format.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound_port.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/jbuf.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/clock.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_adapter_sample.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/master_port.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/mem_port.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_udp.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ip_helper.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_io.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ssl_sock.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_select.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/types.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/limits.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site_sample.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/lock.h
#10 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/os.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/guid.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/fifobuf.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_i.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list_i.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/except.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_access.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/timer.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/unicode.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rbtree.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/activesock.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/log.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ctype.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_qos.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/array.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string_i.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rand.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/addr_resolv.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/math.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/errno.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ioqueue.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/doxygen.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/assert.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/hash.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_alt.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_buf.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/time.h
#10 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_sunos.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_m68k.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/malloc.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_msvc.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_armv4.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux_kernel.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/limits.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32_wince.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_armcc.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_powerpc.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_rtems.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/high_precision.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_codew.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcce.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_x86_64.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h.in
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/setjmp.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_darwinos.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winuwp.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdfileio.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_alpha.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/ctype.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_mwcc.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_symbian.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/rand.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/errno.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdarg.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/size_t.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h.in
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_i386.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/assert.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcc.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/socket.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winphone8.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_palmos.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/string.h
#10 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_sparc.h
#10 19.81 .../node_modules/react-native-pjsip postinstall: Done
#10 ...

#11 [backend builder  6/12] RUN pnpm install --frozen-lockfile
#11 10.97 Progress: resolved 1158, reused 0, downloaded 810, added 799
#11 11.97 Progress: resolved 1158, reused 0, downloaded 877, added 876
#11 12.97 Progress: resolved 1158, reused 0, downloaded 943, added 943
#11 13.97 Progress: resolved 1158, reused 0, downloaded 1042, added 1042
#11 14.97 Progress: resolved 1158, reused 0, downloaded 1155, added 1155
#11 15.24 Progress: resolved 1158, reused 0, downloaded 1158, added 1158, done
#11 15.62 .../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
#11 15.63 .../node_modules/unrs-resolver postinstall$ napi-postinstall unrs-resolver 1.11.1 check
#11 15.63 .../esbuild@0.21.5/node_modules/esbuild postinstall$ node install.js
#11 15.63 .../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
#11 15.63 .../esbuild@0.18.20/node_modules/esbuild postinstall$ node install.js
#11 15.77 .../esbuild@0.25.12/node_modules/esbuild postinstall: Done
#11 15.79 .../node_modules/unrs-resolver postinstall: Done
#11 15.80 .../node_modules/react-native-pjsip postinstall$ bash libs.sh
#11 15.82 .../node_modules/react-native-pjsip postinstall:   % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
#11 15.82 .../node_modules/react-native-pjsip postinstall:                                  Dload  Upload   Total   Spent    Left  Speed
#11 15.83 .../esbuild@0.18.20/node_modules/esbuild postinstall: Done
#11 15.91 .../node_modules/react-native-pjsip postinstall:   0     0   0     0   0     0     0     0  --:--:-- --:--:-- --:--:--     0
#11 15.91 .../node_modules/react-native-pjsip postinstall:   0     0   0     0   0     0     0     0  --:--:-- --:--:-- --:--:--     0
#11 15.92 .../esbuild@0.21.5/node_modules/esbuild postinstall: Done
#11 16.00 .../esbuild@0.27.2/node_modules/esbuild postinstall: Done
#11 17.54 .../node_modules/react-native-pjsip postinstall:  41 74142k  41 30720k   0     0 42982k     0   0:00:01 --:--:--  0:00:01 42982k
#11 17.84 .../node_modules/react-native-pjsip postinstall:  83 74142k  83 61551k   0     0 35735k     0   0:00:02  0:00:01  0:00:01 30617k
#11 17.85 .../node_modules/react-native-pjsip postinstall: 100 74142k 100 74142k   0     0 36641k     0   0:00:02  0:00:02 --:--:-- 33197k
#11 17.85 .../node_modules/react-native-pjsip postinstall: ./
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./ios/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libopenh264.so
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86_64/libpjsua2.so
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libopenh264.so
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/arm64-v8a/libpjsua2.so
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libopenh264.so
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/x86/libpjsua2.so
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libopenh264.so
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/jniLibs/armeabi-v7a/libpjsua2.so
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCameraInfo.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/PjCamera.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentObject.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnSelectAccountParam.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTransaction.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStateParam.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_name_type.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamInfo.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IpChangeParam.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ipv6_use.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingSubscribeParam.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportParam.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtp.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjrpid_activity.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_log_decoration.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/WindowHandle.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamCreatedParam.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_flags_e.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfo.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_packing.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_event_type.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_destroy_flag.java
#11 18.25 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxData.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_event_id_e.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_stun_use.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_cap.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_cred_data_type.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendTypingIndicationParam.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_status_code.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_use.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSendRequestParam.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_media_status.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRxOfferParam.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StreamStat.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayer.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDesc.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallOpParam.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogConfig.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pjmedia_vid_dev_hwnd_type.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_unsigned_char.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_sip_timer_use.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVector.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnBuddyEvSubStateParam.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsConfig.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfoVector.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JsonDocument.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SrtpCrypto.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfoVector.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SdpSession.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_bool_t.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountIpChangeConfig.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AuthCredInfoVector.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_dialog_cap_status.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipRxData.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidDevManager.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_mode.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamInfo.java
#11 18.26 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LossType.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaStateParam.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_vid_strm_op.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_p_void.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertInfo.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RegProgressParam.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_dir.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountRegConfig.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_vid_req_keyframe_method.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaPlayerInfo.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/FindBuddyMatch.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageParam.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cert_verify_flag_t.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallRedirectedParam.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEvent.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecFmtpVector.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMwiConfig.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/EpConfig.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipTxOption.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_wmm_prio.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_ip_change_op.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UaConfig.java
#11 18.27 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFmtChangedEvent.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_id.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowInfo.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaTransportInfo.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaEventParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxMsgEvent.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallStateParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tp_proto.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountPresConfig.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTsxStateParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnInstantMessageStatusParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_type.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PendingJob.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_flag.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_params.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2Constants.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_format_id.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_turn_tp_type.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPart.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEventSrc.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_invalid_id_const_.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Media.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnDtmfDigitParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyVector.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountCallConfig.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountMediaConfig.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindowHandle.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PersistentDocument.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogEntry.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCreateMediaTransportSrtpParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresenceStatus.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaRecorder.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_desc.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountNatConfig.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_evsub_state.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfoVector.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaConfig.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfoVector.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTxOfferParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoWindow.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeaderVector.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimeVal.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Account.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyInfo.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_pj_ssize_t.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneGenerator.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SendInstantMessageParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaCoordinate.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplacedParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTransportStateParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit_map.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_srtp_crypto_option.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioDevInfo.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RxMsgEvent.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Call.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapDigit.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallSdpCreatedParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TxErrorEvent.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMediaVector.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallVidSetStreamParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ConfPortInfo.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_file_access.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_player_option.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipEventBody.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnStreamDestroyedParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_nat64_opt.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_snd_dev_id.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VidCodecParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpSdes.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTimerParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_tone_digit.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_tsx_state_e.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_redirect_op.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudioMedia.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_role_e.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipHeader.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStat.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_call_hold_type.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_dev_std_index.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_sock_proto.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIncomingCallParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnTypingIndicationParam.java
#11 18.28 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_vid_stream_rc_method.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AudDevManager.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Endpoint.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_file_writer_option.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnIpChangeProgressParam.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_state.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMultipartPartVector.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_type.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreview.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferStatusParam.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_orient.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEvent.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_qos_flag.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_stun_nat_type.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaSize.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitMapVector.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatVideo.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigitVector.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MathStat.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportInfo.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_create_media_transport_flag.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnRegStartedParam.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallInfo.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountSipConfig.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/PresNotifyParam.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SipMediaType.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallReplaceRequestParam.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_ssl_method.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_ssl_cipher.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoPreviewOpParam.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SslCertName.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParam.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/UserEvent.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecParamSetting.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatCheckStunServersCompleteParam.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_hdr_e.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CodecInfo.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TlsInfo.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormatAudio.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TsxStateEvent.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_med_tp_st.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDigit.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_type_e.java
#11 18.29 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_inv_state.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnMwiInfoParam.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Buddy.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/RtcpStreamStat.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TransportConfig.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/TimerEvent.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/JbufState.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountConfig.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/IntVector.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_route.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/BuddyConfig.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaFormat.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/LogWriter.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Error.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_100rel_use.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ContainerNode.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua_buddy_status.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsua2JNI.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_std__vectorT_pj__MediaFormat_t.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoDevInfo.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountInfo.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjsip_transport_state.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/VideoSwitchParam.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallSetting.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/Version.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SslCertName_t.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/CallMediaInfo.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_void.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pj_constants_.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallTransferRequestParam.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnCallMediaTransportStateParam.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/StringVector.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/pjmedia_aud_dev_cap.java
#11 18.30 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/SWIGTYPE_p_vectorT_pj__SrtpCrypto_t.java
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/MediaEventData.java
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/AccountVideoConfig.java
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/OnNatDetectionCompleteParam.java
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./android/src/main/java/org/pjsip/pjsua2/ToneDescVector.java
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/VialerPJSIP
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_simple.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/ZsrtpCWrapper.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2.hpp
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/transport_zrtp.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_videodev.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_auth.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia_audiodev.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib++.hpp
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip_ua.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketGoClear.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheFile.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCodes.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHello.h
#11 19.70 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Decode.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStateClass.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketBase.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecord.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPing.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallback.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCacheDb.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCallbackWrapper.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpB64Encode.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketHelloAck.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZRtp.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpCacheDbBackend.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpTextData.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/Base32.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConf2Ack.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordDb.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketError.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCWrapper.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpSdesStream.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/zrtpPacket.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketSASrelay.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpUserCallback.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketClearAck.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpStates.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpConfigure.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDCache.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketRelayAck.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketConfirm.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpCrc32.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketDHPart.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZIDRecordFile.h
#11 19.71 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketErrorAck.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketPingAck.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/EmojiBase32.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/libzrtpcpp/ZrtpPacketCommit.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/json.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/persistent.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/doxygen.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/config.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/siptypes.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/account.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/endpoint.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/call.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/presence.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/media.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua2/types.hpp
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem2.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pem.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl3.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ossl_typ.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dtls1.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/err.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bn.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/blowfish.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cms.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/engine.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf_api.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1_mac.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_x86_64.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/kssl.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7s.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/sha.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/symhacks.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_i386.h
#11 19.72 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/bio.h
#11 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc2.h
#11 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dh.h
#11 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ui_compat.h
#11 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509v3.h
#11 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl23.h
#11 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/conf.h
#11 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md5.h
#11 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/x509_vfy.h
#11 19.73 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/txt_db.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/safestack.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdsa.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/objects.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs12.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/crypto.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslv.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pkcs7.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/obj_mac.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/buffer.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srp.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/camellia.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_arm64.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/evp.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/e_os2.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/md4.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/hmac.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/aes.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/comp.h
#11 19.74 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cast.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rc4.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/stack.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ocsp.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ec.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ecdh.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rand.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/opensslconf_ios_armv7.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ts.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/pqueue.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dso.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/seed.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/modes.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ssl2.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/rsa.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/krb5_asn.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/des_old.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ripemd.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/whrlpool.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/tls1.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/mdc2.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/dsa.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/srtp.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/asn1t.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/cmac.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/ebcdic.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/idea.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/openssl/lhash.h
#11 19.75 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/hash.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/lock.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/proactor.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/file.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/list.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/pool.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/timer.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/string.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/tree.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/scanner.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/types.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/os.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj++/sock.hpp
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/types.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/presence.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/iscomposing.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/rpid.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/pidf.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/mwi.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/publish.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/errno.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/xpidf.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub_msg.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-simple/evsub.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_msg.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/config.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/types.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_sock.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_session.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/nat_detect.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_strans.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_session.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/turn_sock.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/errno.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_config.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/ice_session.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_transaction.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjnath/stun_auth.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opencore_amr.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/opus.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_sdp_match.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ffmpeg_vid_codecs.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/speex.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/passthrough.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h.in
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/types.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/silk.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ilbc.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/gsm.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221_sdp_match.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g722.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/bcg729.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h264_packetizer.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/h263_packetizer.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/amr_helper.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/audio_codecs.h
#11 19.76 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/ipp_codecs.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/l16.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/vid_toolbox.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/config_auto.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/openh264.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-codec/g7221.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_console.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_bitwise.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/http_client.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/base64.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/config.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/types.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_imp.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/md5.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns_server.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_md5.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/getopt.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner_cis_uint.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/xml.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/scanner.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/json.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/resolver.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/hmac_sha1.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/cli_telnet.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/srv_resolver.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/pcap.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/sha1.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/errno.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/stun_simple.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/dns.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/crc32.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjlib-util/string.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_ver.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_def.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_api.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/wels/codec_app_def.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_100rel.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_inv.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_xfer.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_regc.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_replaces.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip-ua/sip_timer.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/config.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/opengl_dev.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/errno.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/videodev_imp.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-videodev/avi_dev.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/config.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiodev_imp.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/errno.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia-audiodev/audiotest.h
#11 19.77 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_module.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_types.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_tel_uri.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_event.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_util.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tcp.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_loop.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_msg.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_private.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_endpoint.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_tls.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_multipart.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_parser.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_autoconf.h.in
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_msg.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_uri.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_ua_layer.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transaction.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_transport_udp.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/print_util.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_errno.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_dialog.h
#11 19.78 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_parser.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_config.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_auth_aka.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsip/sip_resolve.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua_internal.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjsua-lib/pjsua.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_multistream.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_types.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/opus/opus_defines.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_port.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/circbuf.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/conference.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/resample.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/endpoint.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_playlist.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/bidirectional.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_tee.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/port.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/symbian_sound_aps.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_srtp.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/delaybuf.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stereo.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h.in
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp_xr.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/event.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/types.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/tonegen.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/videodev.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi_stream.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/null_port.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtp.h
#11 19.79 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/avi.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/audiodev.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/silencedet.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/frame.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_loop.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/converter.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wsola.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wav_port.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/alaw_ulaw.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp_neg.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/echo_port.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/codec.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/session.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/signatures.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/splitcomb.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_codec_util.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_ice.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/rtcp.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/vid_stream.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/plc.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/stream_common.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/errno.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/g711.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/wave.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sdp.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/doxygen.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/format.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/sound_port.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/config_auto.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/jbuf.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/clock.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_adapter_sample.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/master_port.h
#11 19.80 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/mem_port.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pjmedia/transport_udp.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ip_helper.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_io.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ssl_sock.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_select.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/types.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/limits.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site_sample.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/lock.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/config_site.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/os.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/guid.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/fifobuf.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_i.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list_i.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/except.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/file_access.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/timer.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/unicode.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/list.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rbtree.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/activesock.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/log.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ctype.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/sock_qos.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/array.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string_i.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/rand.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/addr_resolv.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/math.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/errno.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/ioqueue.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/doxygen.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/assert.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/hash.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_alt.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/pool_buf.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/string.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/time.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_sunos.h
#11 19.81 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_m68k.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/malloc.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_msvc.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_armv4.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux_kernel.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/limits.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32_wince.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_armcc.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_powerpc.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_rtems.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/high_precision.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_codew.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcce.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_x86_64.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h.in
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/setjmp.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_darwinos.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winuwp.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_linux.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdfileio.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_alpha.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/ctype.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_mwcc.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_win32.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_symbian.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/rand.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/errno.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/stdarg.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/size_t.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h.in
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_auto.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_i386.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/assert.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/cc_gcc.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/socket.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_auto.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_winphone8.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/os_palmos.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/string.h
#11 19.82 .../node_modules/react-native-pjsip postinstall: ./ios/VialerPJSIP.framework/Headers/pj/compat/m_sparc.h
#11 19.83 .../node_modules/react-native-pjsip postinstall: Done
#11 ...

#10 [backend deps 6/6] RUN pnpm install --frozen-lockfile --prod
#10 20.83 
#10 20.83 dependencies:
#10 20.83 + @expo/vector-icons 15.0.3
#10 20.83 + @react-native-async-storage/async-storage 2.2.0
#10 20.83 + @react-navigation/bottom-tabs 7.8.12
#10 20.83 + @react-navigation/elements 2.9.2
#10 20.83 + @react-navigation/native 7.1.25
#10 20.83 + @tanstack/react-query 5.90.12
#10 20.83 + @trpc/client 11.7.2
#10 20.83 + @trpc/react-query 11.7.2
#10 20.83 + @trpc/server 11.7.2
#10 20.83 + @types/pg 8.20.0
#10 20.83 + axios 1.13.2
#10 20.83 + clsx 2.1.1
#10 20.83 + cookie 1.1.1
#10 20.83 + dotenv 16.6.1
#10 20.83 + drizzle-orm 0.44.7
#10 20.83 + expo 54.0.29
#10 20.83 + expo-audio 1.1.0
#10 20.83 + expo-build-properties 1.0.10
#10 20.83 + expo-constants 18.0.12
#10 20.83 + expo-dev-client 6.0.21
#10 20.83 + expo-font 14.0.10
#10 20.83 + expo-haptics 15.0.8
#10 20.83 + expo-image 3.0.11
#10 20.83 + expo-keep-awake 15.0.8
#10 20.83 + expo-linking 8.0.10
#10 20.83 + expo-notifications 0.32.15
#10 20.83 + expo-router 6.0.19
#10 20.83 + expo-secure-store 15.0.8
#10 20.83 + expo-splash-screen 31.0.12
#10 20.83 + expo-status-bar 3.0.9
#10 20.83 + expo-symbols 1.0.8
#10 20.83 + expo-system-ui 6.0.9
#10 20.83 + expo-video 3.0.15
#10 20.83 + expo-web-browser 15.0.10
#10 20.83 + express 4.22.1
#10 20.83 + google-auth-library 10.6.2
#10 20.83 + ioredis 5.10.1
#10 20.83 + jose 6.1.0
#10 20.83 + mysql2 3.16.0
#10 20.83 + nativewind 4.2.1
#10 20.83 + pg 8.20.0
#10 20.83 + react 19.1.0
#10 20.83 + react-dom 19.1.0
#10 20.83 + react-native 0.81.5
#10 20.83 + react-native-callkeep 4.3.16
#10 20.83 + react-native-gesture-handler 2.28.0
#10 20.83 + react-native-pjsip 2.7.4
#10 20.83 + react-native-reanimated 4.1.6
#10 20.83 + react-native-safe-area-context 5.6.2
#10 20.83 + react-native-screens 4.16.0
#10 20.83 + react-native-svg 15.12.1
#10 20.83 + react-native-web 0.21.2
#10 20.83 + react-native-worklets 0.5.1
#10 20.83 + superjson 1.13.3
#10 20.83 + tailwind-merge 2.6.0
#10 20.83 + zod 4.2.1
#10 20.83 + zustand 5.0.12
#10 20.83 
#10 20.83 devDependencies: skipped
#10 20.83 
#10 20.85 
#10 20.85 > phone11-mobile@1.0.0 postinstall /app
#10 20.85 > node scripts/patch-react-native-pjsip.mjs
#10 20.85 
#10 20.89 node:internal/modules/cjs/loader:1386
#10 20.89   throw err;
#10 20.89   ^
#10 20.89 
#10 20.89 Error: Cannot find module '/app/scripts/patch-react-native-pjsip.mjs'
#10 20.89     at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)
#10 20.89     at defaultResolveImpl (node:internal/modules/cjs/loader:1025:19)
#10 20.89     at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1030:22)
#10 20.89     at Function._load (node:internal/modules/cjs/loader:1192:37)
#10 20.89     at TracingChannel.traceSync (node:diagnostics_channel:328:14)
#10 20.89     at wrapModuleLoad (node:internal/modules/cjs/loader:237:24)
#10 20.89     at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)
#10 20.89     at node:internal/main/run_main_module:36:49 {
#10 20.89   code: 'MODULE_NOT_FOUND',
#10 20.89   requireStack: []
#10 20.89 }
#10 20.89 
#10 20.89 Node.js v22.22.2
#10 20.89  ELIFECYCLE  Command failed with exit code 1.
#10 ...

#11 [backend builder  6/12] RUN pnpm install --frozen-lockfile
#11 20.97 
#11 20.97 dependencies:
#11 20.97 + @expo/vector-icons 15.0.3
#11 20.97 + @react-native-async-storage/async-storage 2.2.0
#11 20.97 + @react-navigation/bottom-tabs 7.8.12
#11 20.97 + @react-navigation/elements 2.9.2
#11 20.97 + @react-navigation/native 7.1.25
#11 20.97 + @tanstack/react-query 5.90.12
#11 20.97 + @trpc/client 11.7.2
#11 20.97 + @trpc/react-query 11.7.2
#11 20.97 + @trpc/server 11.7.2
#11 20.97 + @types/pg 8.20.0
#11 20.97 + axios 1.13.2
#11 20.97 + clsx 2.1.1
#11 20.97 + cookie 1.1.1
#11 20.97 + dotenv 16.6.1
#11 20.97 + drizzle-orm 0.44.7
#11 20.97 + expo 54.0.29
#11 20.97 + expo-audio 1.1.0
#11 20.97 + expo-build-properties 1.0.10
#11 20.97 + expo-constants 18.0.12
#11 20.97 + expo-dev-client 6.0.21
#11 20.97 + expo-font 14.0.10
#11 20.97 + expo-haptics 15.0.8
#11 20.97 + expo-image 3.0.11
#11 20.97 + expo-keep-awake 15.0.8
#11 20.97 + expo-linking 8.0.10
#11 20.97 + expo-notifications 0.32.15
#11 20.97 + expo-router 6.0.19
#11 20.97 + expo-secure-store 15.0.8
#11 20.97 + expo-splash-screen 31.0.12
#11 20.97 + expo-status-bar 3.0.9
#11 20.97 + expo-symbols 1.0.8
#11 20.97 + expo-system-ui 6.0.9
#11 20.97 + expo-video 3.0.15
#11 20.97 + expo-web-browser 15.0.10
#11 20.97 + express 4.22.1
#11 20.97 + google-auth-library 10.6.2
#11 20.97 + ioredis 5.10.1
#11 20.97 + jose 6.1.0
#11 20.97 + mysql2 3.16.0
#11 20.97 + nativewind 4.2.1
#11 20.97 + pg 8.20.0
#11 20.97 + react 19.1.0
#11 20.97 + react-dom 19.1.0
#11 20.97 + react-native 0.81.5
#11 20.97 + react-native-callkeep 4.3.16
#11 20.97 + react-native-gesture-handler 2.28.0
#11 20.97 + react-native-pjsip 2.7.4
#11 20.97 + react-native-reanimated 4.1.6
#11 20.97 + react-native-safe-area-context 5.6.2
#11 20.97 + react-native-screens 4.16.0
#11 20.97 + react-native-svg 15.12.1
#11 20.97 + react-native-web 0.21.2
#11 20.97 + react-native-worklets 0.5.1
#11 20.97 + superjson 1.13.3
#11 20.97 + tailwind-merge 2.6.0
#11 20.97 + zod 4.2.1
#11 20.97 + zustand 5.0.12
#11 20.97 
#11 20.97 devDependencies:
#11 20.97 + @config-plugins/react-native-callkeep 12.0.0
#11 20.97 + @expo/ngrok 4.1.3
#11 20.97 + @types/cookie 0.6.0
#11 20.97 + @types/express 4.17.25
#11 20.97 + @types/node 22.19.3
#11 20.97 + @types/qrcode 1.5.6
#11 20.97 + @types/react 19.1.17
#11 20.97 + concurrently 9.2.1
#11 20.97 + cross-env 7.0.3
#11 20.97 + drizzle-kit 0.31.8
#11 20.97 + esbuild 0.25.12
#11 20.97 + eslint 9.39.2
#11 20.97 + eslint-config-expo 10.0.0
#11 20.97 + prettier 3.7.4
#11 20.97 + qrcode 1.5.4
#11 20.97 + tailwindcss 3.4.19
#11 20.97 + tsx 4.21.0
#11 20.97 + typescript 5.9.3
#11 20.97 + vitest 2.1.9
#11 20.97 
#11 21.14 
#11 21.14 > phone11-mobile@1.0.0 postinstall /app
#11 21.14 > node scripts/patch-react-native-pjsip.mjs
#11 21.14 
#11 21.18 node:internal/modules/cjs/loader:1386
#11 21.18   throw err;
#11 21.18   ^
#11 21.18 
#11 21.18 Error: Cannot find module '/app/scripts/patch-react-native-pjsip.mjs'
#11 21.18     at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)
#11 21.18     at defaultResolveImpl (node:internal/modules/cjs/loader:1025:19)
#11 21.18     at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1030:22)
#11 21.18     at Function._load (node:internal/modules/cjs/loader:1192:37)
#11 21.18     at TracingChannel.traceSync (node:diagnostics_channel:328:14)
#11 21.18     at wrapModuleLoad (node:internal/modules/cjs/loader:237:24)
#11 21.18     at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)
#11 21.18     at node:internal/main/run_main_module:36:49 {
#11 21.18   code: 'MODULE_NOT_FOUND',
#11 21.18   requireStack: []
#11 21.18 }
#11 21.18 
#11 21.18 Node.js v22.22.2
#11 21.18  ELIFECYCLE  Command failed with exit code 1.
#11 ERROR: process "/bin/sh -c pnpm install --frozen-lockfile" did not complete successfully: exit code: 1

#10 [backend deps 6/6] RUN pnpm install --frozen-lockfile --prod
#10 ERROR: process "/bin/sh -c pnpm install --frozen-lockfile --prod" did not complete successfully: exit code: 1
------
 > [backend builder  6/12] RUN pnpm install --frozen-lockfile:
21.18     at TracingChannel.traceSync (node:diagnostics_channel:328:14)
21.18     at wrapModuleLoad (node:internal/modules/cjs/loader:237:24)
21.18     at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)
21.18     at node:internal/main/run_main_module:36:49 {
21.18   code: 'MODULE_NOT_FOUND',
21.18   requireStack: []
21.18 }
21.18 
21.18 Node.js v22.22.2
21.18  ELIFECYCLE  Command failed with exit code 1.
------
------
 > [backend deps 6/6] RUN pnpm install --frozen-lockfile --prod:
20.89     at TracingChannel.traceSync (node:diagnostics_channel:328:14)
20.89     at wrapModuleLoad (node:internal/modules/cjs/loader:237:24)
20.89     at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)
20.89     at node:internal/main/run_main_module:36:49 {
20.89   code: 'MODULE_NOT_FOUND',
20.89   requireStack: []
20.89 }
20.89 
20.89 Node.js v22.22.2
20.89  ELIFECYCLE  Command failed with exit code 1.
------
failed to solve: process "/bin/sh -c pnpm install --frozen-lockfile" did not complete successfully: exit code: 1
```
