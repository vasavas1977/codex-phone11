# Phone11 Android staging Firebase inventory

Read-only inventory taken 2026-09-14 (Asia/Bangkok) from source head
`0b3b870007c2f7bd58b1a9cb2e7ccf46202370b7`. No project, app, API, billing,
credential, deployment, or production setting was changed. Raw access tokens,
API keys, refresh tokens, and credential contents were neither printed nor
recorded.

## Result

**Blocked: there is no confirmed isolated staging Firebase target for the
Phone11 Android commissioning gate.** The gate requires Android package
`ai.phone11.mobile.staging` and a project ID containing `staging`, `stage`,
`sandbox`, or `nonprod`. No accessible project ID meets that condition. No
local `google-services.json` matches the required package.

`phone11-push` is the nearest inventory candidate, but it is not a safe target:
its name does not identify staging and its only registered Android app is for
package `space.manus.phone11ai.t20260425073427`. Reusing that app or its local
configuration would fail the repository's commissioning checks.

## Local tools and authentication

- Google Cloud CLI: `/opt/homebrew/bin/gcloud`, version `572.0.0`.
- Firebase CLI: not installed.
- Active gcloud account: `vasavas1977@gmail.com`.
- Saved inactive gcloud identity:
  `super-number-agent@mobile11-9e1c5.iam.gserviceaccount.com`.
- Current gcloud project: `mobile11-9e1c5`.
- gcloud credential database: present with owner-only permissions (`0600`).
- Application Default Credentials: present with owner-only permissions
  (`0600`), type `authorized_user`, quota project
  `gen-lang-client-0617330545`.
- `GOOGLE_APPLICATION_CREDENTIALS`: unset.
- Firebase CLI credential/config stores checked: absent.

## Accessible Google Cloud projects

All returned `ACTIVE`:

| Project ID | Display name |
|---|---|
| `onetoall-super-device` | 1-TO-ALL Super Device |
| `gen-lang-client-0198731337` | vasavas me |
| `gen-lang-client-0338752558` | phone11 |
| `note11-504012` | note11 |
| `note11-499309` | note11 |
| `mobile11-9e1c5` | Mobile11 |
| `phone11-495204` | Phone11 |
| `phone11-push` | phone11-push |
| `gen-lang-client-0617330545` | Gemini Project with manus |
| `mobile11-voice-bot` | mobile11-voice-bot |
| `nodal-keep-477501-d5` | My First Project |
| `gen-lang-client-0505175094` | ai transcription lovable |
| `gen-lang-client-0622677479` | chatbot for gemini |
| `wordplayground-ia7ev` | WordPlayground |
| `studio-no25r` | studio |
| `gen-lang-client-0544234747` | Gemini API |

## Phone11 candidate checks

| Project ID | Billing linked | Firebase inventory | Android apps |
|---|---:|---|---|
| `phone11-495204` | Yes; billing account ID redacted | Firebase Management API disabled; no API was enabled | Not inspected because the API is disabled |
| `phone11-push` | No | Firebase project `ACTIVE`; Firebase Management API enabled | `1:472816312708:android:d0f558eeaf0cfaf8febdd1`, package `space.manus.phone11ai.t20260425073427`, state `ACTIVE` |
| `gen-lang-client-0338752558` | No | Firebase Management API disabled; no API was enabled | Not inspected because the API is disabled |

The `phone11-push` project labels report `firebase=enabled` and
`firebase-core=disabled`. No candidate has a staging/nonproduction label or
project ID accepted by the commissioning gate.

## Local `google-services.json` inventory

- Target worktree: `android/app/google-services.json` is absent. The generated
  Android tree is ignored by the repository, and the Expo configuration accepts
  an explicitly supplied external file only when the commissioning gate is on.
- `/Users/vasavas16macbookpro/Downloads/google-services.json` exists outside
  Git. It belongs to `phone11-push`, app
  `1:472816312708:android:d0f558eeaf0cfaf8febdd1`, package
  `space.manus.phone11ai.t20260425073427`. SHA-256:
  `aa7adf7fc4ac68871a9a1fde6d686123e43c24d86d6076cc01682f238930f78b`.
  It does not match the required staging package.
- One 25-byte file named `google-services.json` exists in an older Siprix trial
  directory, but it is invalid JSON and is not usable configuration.
- Fifteen other valid files found in the searched local paths belong to
  `mobile11-9e1c5` and package `io.mobile11.app`; none is a Phone11 match.

Search scope covered the target worktree, `~/Documents`, `~/Downloads`,
`~/.config`, `~/.firebase`, the known `~/esimflow-connect` tree, and macOS
Spotlight results for `google-services.json`.

## Safe next target definition

A safe target must be a separately authorized Firebase project whose ID names
staging/nonproduction, with exactly one Android app for
`ai.phone11.mobile.staging`, billing linkage intentionally confirmed, and a
matching external `google-services.json`. None of those prerequisites is
currently available, so commissioning remains off.
