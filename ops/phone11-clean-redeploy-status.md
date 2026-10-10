# Phone11 Clean Backend Redeploy Status

- Time UTC: 2026-05-17T15:15:20+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 0788fe956648dafc153ba8891bc0428289b08a18
- EC2 host: 43.209.112.208
- EC2 instance: i-0cc8f248b08c5f2fb
- Result: success
- Exit code: 0

## Sanitized output
```text
=== Phone11 clean backend redeploy ===
Time: 2026-05-17T15:06:36+00:00
--- Locating EC2 instance ---
Found EC2 instance i-0cc8f248b08c5f2fb in ap-southeast-7b
--- Preparing temporary SSH access ---
{
    "RequestId": "3ba08948-90c9-458b-a435-c00f38f7a374",
    "Success": true
}
--- Cleaning EC2 Docker cache before rebuild ---
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
Disk before cleanup:
Filesystem      Size  Used Avail Use% Mounted on
/dev/root        48G  9.0G   39G  19% /
/dev/root        48G  9.0G   39G  19% /
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          3         1         1.38GB    1.224GB (88%)
Containers      1         1         4.096kB   0B (0%)
Local Volumes   0         0         0B        0B
Build Cache     0         0         0B        0B
a9b1bf9ab505 cp11-backend Up 30 minutes (healthy)
DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
            Install the buildx component to build images with BuildKit:
            https://docs.docker.com/go/buildx/

Total reclaimed space: 0B
Total reclaimed space: 0B
Deleted Images:
untagged: node:22-alpine
deleted: sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
deleted: sha256:757ec364de4d37cedf30871be2988927660834e656e9aa52aad9ac194814c30c
deleted: sha256:bfaaa13062d14b2f966de80d367e30367abd5c155d443653fc4cfb8d8d01e31a
untagged: sha256:52798a393a04f4dcd6e37f8efb52e0ae0902218d7acd47b430024a055f5e4df5
deleted: sha256:52798a393a04f4dcd6e37f8efb52e0ae0902218d7acd47b430024a055f5e4df5
untagged: sha256:70395147dc70975ba3db7108cc6de64dc04f2cfe5a1e4083cbb0444d8ac19d4e
deleted: sha256:70395147dc70975ba3db7108cc6de64dc04f2cfe5a1e4083cbb0444d8ac19d4e
untagged: sha256:93094577fefcad68433e3716276a563357af754d1ea01595ca0898b6a41b2dd2
deleted: sha256:93094577fefcad68433e3716276a563357af754d1ea01595ca0898b6a41b2dd2
untagged: sha256:b5536f799d778164e9c5384dcd634c2cd1c6b28649d51b76a768b3a800ce68ff
deleted: sha256:b5536f799d778164e9c5384dcd634c2cd1c6b28649d51b76a768b3a800ce68ff
untagged: sha256:bbc4263cc5d83b0981a505ffc04ba2cd39dbc0d0c86801c08f2e68aaf4f64485
deleted: sha256:bbc4263cc5d83b0981a505ffc04ba2cd39dbc0d0c86801c08f2e68aaf4f64485

Total reclaimed space: 62.41MB
Total reclaimed space: 0B
Vacuuming done, freed 0B of archived journals from /var/log/journal.
Vacuuming done, freed 0B of archived journals from /run/log/journal.
Vacuuming done, freed 0B of archived journals from /var/log/journal/ec20fbfc8f0cc8e2e1ccfe9e56334634.
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
Time: 2026-05-17T15:07:03+00:00
GitHub SHA: 0788fe956648dafc153ba8891bc0428289b08a18
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
 * branch            0788fe956648dafc153ba8891bc0428289b08a18 -> FETCH_HEAD
Warning: you are leaving 1 commit behind, not connected to
any of your branches:

  9cb409e Trigger Phone11 clean backend redeploy

If you want to keep it by creating a new branch, this may be a good time
to do so with:

 git branch <new-branch-name> 9cb409e

HEAD is now at 0788fe9 Retry Phone11 clean backend redeploy
--- Deploying standalone public API backend container ---
DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
            Install the buildx component to build images with BuildKit:
            https://docs.docker.com/go/buildx/

Sending build context to Docker daemon  22.59MB
Step 1/39 : FROM node:22-alpine AS deps
22-alpine: Pulling from library/node
35cf660f63b0: Pulling fs layer
b6816b6a0419: Pulling fs layer
2ad77fb7cfd3: Pulling fs layer
3e7ca773cb61: Download complete
32e2c9b279ac: Download complete
b6816b6a0419: Download complete
35cf660f63b0: Download complete
2ad77fb7cfd3: Download complete
b6816b6a0419: Pull complete
35cf660f63b0: Pull complete
2ad77fb7cfd3: Pull complete
Digest: sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920
Status: Downloaded newer image for node:22-alpine
 ---> 968df39aedce
Step 2/39 : WORKDIR /app
 ---> Running in 082d2b4be27a
 ---> Removed intermediate container 082d2b4be27a
 ---> 003f065e8b99
Step 3/39 : RUN apk add --no-cache bash curl ca-certificates
 ---> Running in 86e1a2d21949
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
 ---> Removed intermediate container 86e1a2d21949
 ---> 821df34d539f
Step 4/39 : RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
 ---> Running in 0342cce32608
Preparing pnpm@9.12.0 for immediate activation...
 ---> Removed intermediate container 0342cce32608
 ---> d1e91d30861b
Step 5/39 : COPY package.json pnpm-lock.yaml ./
 ---> 7eacd4b0f5d6
Step 6/39 : COPY scripts/ ./scripts/
 ---> 157f67d605d5
Step 7/39 : RUN pnpm install --frozen-lockfile --prod
 ---> Running in 003dcbebdb23
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

Progress: resolved 899, reused 0, downloaded 14, added 4
Progress: resolved 899, reused 0, downloaded 106, added 99
Progress: resolved 899, reused 0, downloaded 238, added 229
Progress: resolved 899, reused 0, downloaded 353, added 343
Progress: resolved 899, reused 0, downloaded 362, added 350
Progress: resolved 899, reused 0, downloaded 446, added 443
Progress: resolved 899, reused 0, downloaded 520, added 513
Progress: resolved 899, reused 0, downloaded 585, added 584
Progress: resolved 899, reused 0, downloaded 646, added 638
Progress: resolved 899, reused 0, downloaded 699, added 686
Progress: resolved 899, reused 0, downloaded 781, added 765
Progress: resolved 899, reused 0, downloaded 842, added 829
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
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 109.6M      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 109.6M      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 109.6M      0                              0
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
Done in 18.4s
 ---> Removed intermediate container 003dcbebdb23
 ---> 2145b1807fae
Step 8/39 : RUN if [ ! -e node_modules/ws ]; then       WS_DIR="$(find node_modules/.pnpm -path '*/node_modules/ws' -type d | sort | tail -n 1)";       test -n "$WS_DIR";       ln -s "/app/$WS_DIR" node_modules/ws;     fi
 ---> Running in 5107d3a7d4ea
 ---> Removed intermediate container 5107d3a7d4ea
 ---> 570c5ac70a3c
Step 9/39 : FROM node:22-alpine AS builder
 ---> 968df39aedce
Step 10/39 : WORKDIR /app
 ---> Running in 29298688b129
 ---> Removed intermediate container 29298688b129
 ---> 6a8cf0ffaae4
Step 11/39 : RUN apk add --no-cache bash curl ca-certificates
 ---> Running in 985e82694a75
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
 ---> Removed intermediate container 985e82694a75
 ---> 5ada58282f6c
Step 12/39 : RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
 ---> Running in 370868d3fc1d
Preparing pnpm@9.12.0 for immediate activation...
 ---> Removed intermediate container 370868d3fc1d
 ---> 1a91bb5b586a
Step 13/39 : COPY package.json pnpm-lock.yaml ./
 ---> c20a5cfe7020
Step 14/39 : COPY scripts/ ./scripts/
 ---> 93bed84ecf18
Step 15/39 : RUN pnpm install --frozen-lockfile
 ---> Running in e0d993db8e8b
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
Progress: resolved 1158, reused 0, downloaded 96, added 95
Progress: resolved 1158, reused 0, downloaded 234, added 228
Progress: resolved 1158, reused 0, downloaded 347, added 339
Progress: resolved 1158, reused 0, downloaded 362, added 355
Progress: resolved 1158, reused 0, downloaded 452, added 447
Progress: resolved 1158, reused 0, downloaded 516, added 511
Progress: resolved 1158, reused 0, downloaded 605, added 605
Progress: resolved 1158, reused 0, downloaded 665, added 656
Progress: resolved 1158, reused 0, downloaded 726, added 715
Progress: resolved 1158, reused 0, downloaded 824, added 815
Progress: resolved 1158, reused 0, downloaded 884, added 882
Progress: resolved 1158, reused 0, downloaded 933, added 930
Progress: resolved 1158, reused 0, downloaded 1034, added 1024
Progress: resolved 1158, reused 0, downloaded 1118, added 1113
Progress: resolved 1158, reused 0, downloaded 1158, added 1158, done
.../esbuild@0.25.12/node_modules/esbuild postinstall$ node install.js
.../esbuild@0.18.20/node_modules/esbuild postinstall$ node install.js
.../esbuild@0.27.2/node_modules/esbuild postinstall$ node install.js
.../esbuild@0.21.5/node_modules/esbuild postinstall$ node install.js
.../node_modules/unrs-resolver postinstall$ napi-postinstall unrs-resolver 1.11.1 check
.../node_modules/unrs-resolver postinstall: Done
.../esbuild@0.25.12/node_modules/esbuild postinstall: Done
.../node_modules/react-native-pjsip postinstall$ bash libs.sh
.../node_modules/react-native-pjsip postinstall:   % Total    % Received % Xferd  Average Speed  Time    Time    Time   Current
.../node_modules/react-native-pjsip postinstall:                                  Dload  Upload  Total   Spent   Left   Speed
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../esbuild@0.18.20/node_modules/esbuild postinstall: Done
.../esbuild@0.21.5/node_modules/esbuild postinstall: Done
.../esbuild@0.27.2/node_modules/esbuild postinstall: Done
.../node_modules/react-native-pjsip postinstall:   0      0   0      0   0      0      0      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 99.40M      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 99.38M      0                              0
.../node_modules/react-native-pjsip postinstall: 100 72.40M 100 72.40M   0      0 99.36M      0                              0
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
Done in 23.1s
 ---> Removed intermediate container e0d993db8e8b
 ---> 8eb0904e37f8
Step 16/39 : COPY server/ ./server/
 ---> bc6d7934d283
Step 17/39 : COPY shared/ ./shared/
 ---> 453509d1aa34
Step 18/39 : COPY drizzle/ ./drizzle/
 ---> 970bf5a6d9de
Step 19/39 : COPY drizzle.config.ts ./
 ---> 18efda6721de
Step 20/39 : COPY tsconfig.json ./
 ---> 550d18e8a24a
Step 21/39 : RUN pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.mjs
 ---> Running in 13fdd2572b66
[91m
  dist/index.mjs  192.3kb

⚡ Done in 28ms
[0m ---> Removed intermediate container 13fdd2572b66
 ---> 680b275e2e45
Step 22/39 : FROM node:22-alpine AS production
 ---> 968df39aedce
Step 23/39 : LABEL maintainer="CloudPhone11 <ops@cloudphone11.io>"
 ---> Running in 35b388a7a6a7
 ---> Removed intermediate container 35b388a7a6a7
 ---> 3ac014d1ea3e
Step 24/39 : LABEL description="CloudPhone11 backend API server"
 ---> Running in 64c43ecf4194
 ---> Removed intermediate container 64c43ecf4194
 ---> cb57bbe4d9fe
Step 25/39 : WORKDIR /app
 ---> Running in c620f01ba6db
 ---> Removed intermediate container c620f01ba6db
 ---> 491cfc5ed05a
Step 26/39 : RUN addgroup -g 1001 -S cloudphone &&     adduser -S cloudphone -u 1001 -G cloudphone &&     mkdir -p /var/lib/phone11/recordings /var/lib/phone11/voicemail &&     chown -R cloudphone:cloudphone /var/lib/phone11
 ---> Running in 158c197fe89c
 ---> Removed intermediate container 158c197fe89c
 ---> 724f43cb05f0
Step 27/39 : COPY --from=deps /app/node_modules ./node_modules
 ---> c959c68df385
Step 28/39 : COPY --from=builder /app/dist ./dist
 ---> 2666a27919e1
Step 29/39 : COPY --from=builder /app/drizzle ./drizzle
 ---> 915e82ee9d29
Step 30/39 : COPY package.json ./
 ---> 0c582ca3c803
Step 31/39 : ENV NODE_ENV=production
 ---> Running in 41626cead366
 ---> Removed intermediate container 41626cead366
 ---> 765813aee3db
Step 32/39 : ENV PORT=3000
 ---> Running in 118bb4830743
 ---> Removed intermediate container 118bb4830743
 ---> 6cb60866d779
Step 33/39 : ENV HOST=0.0.0.0
 ---> Running in 64abba9aae04
 ---> Removed intermediate container 64abba9aae04
 ---> 61c7a3566e0c
Step 34/39 : ENV RECORDINGS_PATH=/var/lib/phone11/recordings
 ---> Running in f47b46b504c4
 ---> Removed intermediate container f47b46b504c4
 ---> b6029a24960b
Step 35/39 : ENV VOICEMAIL_PATH=/var/lib/phone11/voicemail
 ---> Running in 31d1182d3db4
 ---> Removed intermediate container 31d1182d3db4
 ---> d8c1231596da
Step 36/39 : HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s     CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
 ---> Running in 8b59218cf6b7
 ---> Removed intermediate container 8b59218cf6b7
 ---> 5bfe49c8a59f
Step 37/39 : EXPOSE 3000/tcp
 ---> Running in cfb6ee5c0c16
 ---> Removed intermediate container cfb6ee5c0c16
 ---> e113126a2d9c
Step 38/39 : USER cloudphone
 ---> Running in 292206b8152e
 ---> Removed intermediate container 292206b8152e
 ---> e56d3ba4c5cc
Step 39/39 : CMD ["node", "dist/index.mjs"]
 ---> Running in 6787b309abbb
 ---> Removed intermediate container 6787b309abbb
 ---> 74e770e20848
Successfully built 74e770e20848
Successfully tagged phone11-backend-public:0788fe956648dafc153ba8891bc0428289b08a18
--- Freeing port 3000 for backend container ---
a50c24c34941ce93acd79d861758d2d3fa0f00a074a7237afd1f637ab78c6889
--- Waiting for backend container to stay running ---
Backend state: running restarting=false exit=0
--- Checking RDS managed <redacted> for DB <redacted> repair ---
AWS CLI is not available on EC2 and no workflow-supplied RDS master <redacted> was provided; skipping DB <redacted> repair.
--- Verifying backend DB env and pilot extension ---
Backend DB env present: host=phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com, user=phone11ai, database=phone11ai, ssl=enabled, <redacted>
Backend PG auth OK as phone11ai on phone11ai
Pilot extension ready: 1001 on sip.phone11.ai
--- Waiting for backend container to stay running ---
Backend state: running restarting=false exit=0
--- Waiting for backend health endpoint ---
Health not ready: curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
{"ok":true,"timestamp":1779030919975,"build":"0788fe956648dafc153ba8891bc0428289b08a18","service":"phone11-backend"}
--- Verifying public api.phone11.ai route ---
Public health: {"ok":true,"timestamp":1779030920153,"build":"0788fe956648dafc153ba8891bc0428289b08a18","service":"phone11-backend"}
Redeploy finished.
Backend clean redeploy and pilot verification succeeded.
```
