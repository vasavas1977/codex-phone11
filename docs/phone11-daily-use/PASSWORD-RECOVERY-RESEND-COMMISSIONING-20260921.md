# Phone11 password recovery: Resend commissioning

Source support is present, but password recovery stays disabled until every setting below is provided to the candidate backend. This document does not authorize DNS changes, provider changes, deployment, or email delivery.

## Runtime configuration

Create a Resend API key restricted to sending access and store it in the existing deployment secret channel. Never place the key in source, an image, a command argument, or operator output.

```text
PHONE11_PASSWORD_RESET_PROVIDER=resend
PHONE11_PASSWORD_RESET_RESEND_API_KEY=<secret sending-only key>
PHONE11_PASSWORD_RESET_FROM=Phone11 <noreply@phone11.ai>
```

All three values are required. Partial or unknown configuration fails closed. The Resend endpoint is fixed in source; the runtime cannot redirect email payloads or the API key to another URL. Delivery makes one request with a 10-second timeout and no provider fallback or automatic retry.

`/api/mobile/config` reports recovery as `disabled` until configuration is complete and auth readiness passes. A configured candidate reports `passwordResetAvailability: "general"`; this is a source/configuration state and does not prove domain verification, deployment, or real delivery.

## Commissioning gates

1. Verify the Resend domain for `phone11.ai` and confirm `noreply@phone11.ai` is an allowed sender.
2. In the Resend domain configuration, require both **Open Tracking** and **Click Tracking** to be off. Record a dashboard readback before enabling recovery. Resend configures both features at the domain level; click tracking rewrites links through a redirect and open tracking adds a one-pixel image ([Resend tracking documentation](https://resend.com/blog/open-and-click-tracking)).
3. Create a dedicated sending-only API key. Do not grant domain or account administration access.
4. Obtain independent review of the exact source artifact and secret-injection procedure.
5. Deploy only the candidate backend and add the three explicit runtime settings through the secret channel.
6. Route the exact `POST /api/auth/sign-in/email` path to that candidate before exposing recovery. Require a read-only `GET` probe of the same exact path to return `404` with `X-Phone11-Credential-Serialization: pg-advisory-v1`, then prove every pre-cutover sign-in worker and in-flight request has drained. This is required because reset and credential sign-in share the same database serialization fence.
7. Read `/api/mobile/config`; require `passwordResetEnabled: true` and `passwordResetAvailability: "general"` before exposing the UI or either recovery POST route.
8. Request one owner reset. Confirm the public response is generic and exactly one email is sent. Inspect the received message source and its actual anchor `href`: it must be the exact allowlisted portal reset URL, retain the token only after `#`, contain no Resend or other tracking redirect, and contain no tracking image. Stop commissioning if the received `href` differs from the submitted URL.
9. Open that direct link. Confirm the page removes the fragment immediately, the token works once within 15 minutes, and all prior sessions are rejected.
10. Repeat with an unknown address and confirm the same public status and body. Check internal delivery-failure metrics without logging recipient addresses, reset URLs, API keys, or tokens.

Source tests and readiness do not prove DNS verification, provider key permissions, deployment, provider acceptance, inbox delivery, or a real reset.

## Provider observation (2026-09-21 22:15 Asia/Bangkok)

The Resend UI showed `phone11.ai` verified after all three requested DNS records were saved. Its configuration offered **Enable tracking metrics** and **Configure custom tracking domain**; no custom tracking domain had been created. This observation does not replace the explicit open- and click-tracking readback in the commissioning gates.

A dedicated key named `Phone11 production email` was then created with sending access restricted to `phone11.ai` (provider key ID `449944f8-bf26-48ca-b1e9-dbeecec0db0a`). The key value was transferred through verified SSH standard input into `/root/phone11-password-recovery-secrets.json` on the VOIP host, with root ownership and mode `0600`; the receiving hash matched and the local temporary copy was removed. This records custody and scope only. No value is recorded here, and no email, route change, or deployment had occurred at the time of this update.

## Rollback

Hide and drain the recovery routes first, then restore the exact credential sign-in route to the previous backend. Remove the password-reset runtime settings and redeploy the previous candidate artifact. Recovery then reports disabled and new reset requests return a generic service-unavailable response. Existing sign-in and sign-out paths remain available. Revoke the dedicated Resend key after the rollback backend is healthy. No database rollback is required; expired or outstanding verification rows remain bounded by Better Auth expiry and cannot create a session without a successful single-use reset.

## Tracking readback (2026-09-22)

The live Phone11 domain Configuration page still shows **Enable tracking metrics → Configure**. Opening Configure shows **New tracking subdomain**, not an existing tracking configuration. No tracking subdomain was submitted or created. Resend's current official [tracking documentation](https://resend.com/docs/dashboard/domains/tracking) states both tracking features are disabled by default and documents this same Configure → Add domain → DNS verification activation flow. This establishes the dashboard's unconfigured/default-off state; it is not an API boolean readback. The checked click-tracking option in the unsaved new-domain form is a creation default, not an active setting. The real email's direct link and lack of a tracking image remain a separate delivery check.

## Live owner delivery (2026-09-22)

Frontend `076ddac068dd6efbca91a152f75886127a22c0b2` was verified in a real browser with working sign-in controls, then displayed Forgot password after backend `recovery-bbd14cf` activation. One owner-authorized reset request was submitted through that form. The page returned the generic Check your email result. Resend email ID `01a0c54d-d8c2-721d-8212-bbcf76187f05` reports **Delivered**, subject Reset your Phone11 password, sender Phone11 <noreply@phone11.ai>. Provider email HTML contains exactly one anchor to `https://1toall.phone11.ai/auth/reset-password`, token only in the fragment, no token query parameter, and no image tag. No token was written to this record. This is provider delivery/HTML evidence, not an inbox-source observation.

The owner was asked to enter and submit a new password privately and confirm sign-in; that real-account single-use/session-revocation acceptance is pending. Existing automated transaction/race tests and the live invalid-token rejection do not replace the owner's completion.
