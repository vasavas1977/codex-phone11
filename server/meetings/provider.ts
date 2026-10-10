import { jwtVerify } from "jose";

import type { MeetingGrant, MeetingProvider } from "./service";

/**
 * Legacy Core Guard wire adapter. This is deliberately injectable only; the
 * mounted Phone11 router remains disabled until Connect11's authenticated
 * phone11-conference.v1 facade and issuer-isolation gate are deployed.
 */
export type IsolatedCoreGuardConfig = {
  apiBaseUrl: string;
  serverCredential: string;
  livekitUrl: string;
  livekitIssuer: string;
  livekitSigningSecret: string;
  isolatedProjectVerified: true;
};

export function meetingCoordinates(grant: MeetingGrant) {
  return {
    room: `conf-p11-t${grant.tenantId}-${grant.meetingId}`,
    identity: `p11-t${grant.tenantId}-u${grant.userId}`,
  };
}

export function createIsolatedCoreGuardProvider(
  config: IsolatedCoreGuardConfig,
  request: typeof fetch = fetch,
): MeetingProvider {
  const base = new URL(config.apiBaseUrl);
  const media = new URL(config.livekitUrl);
  if (
    config.isolatedProjectVerified !== true ||
    base.protocol !== "https:" || base.username || base.password || base.search || base.hash ||
    media.protocol !== "wss:" || media.username || media.password || media.search || media.hash ||
    !config.serverCredential || !config.livekitIssuer || config.livekitSigningSecret.length < 32
  ) throw new Error("Isolated meeting provider configuration is required");

  return {
    async join(grant) {
      const coordinates = meetingCoordinates(grant);
      const response = await request(`${base.href.replace(/\/+$/, "")}/get-livekit-token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          apikey: config.serverCredential,
          authorization: `Bearer ${config.serverCredential}`,
        },
        // No interpreter or bot is implicitly started by a video admission.
        body: JSON.stringify({ ...coordinates, mode: "video_only", sourceLang: "th", targetLang: "th" }),
      });
      if (!response.ok) throw new Error("Meeting token request failed");
      const data = await response.json();
      if (data.url !== config.livekitUrl || typeof data.token !== "string" || data.token.length > 16_384) {
        throw new Error("Invalid meeting token response");
      }
      const { payload } = await jwtVerify(data.token, new TextEncoder().encode(config.livekitSigningSecret), {
        algorithms: ["HS256"], issuer: config.livekitIssuer, subject: coordinates.identity,
      });
      const video = payload.video as Record<string, unknown> | undefined;
      const now = Math.floor(Date.now() / 1000);
      if (
        !payload.exp || payload.exp > now + 300 ||
        !video || video.room !== coordinates.room || video.roomJoin !== true ||
        video.roomAdmin === true || video.roomCreate === true || video.roomList === true || video.roomRecord === true ||
        payload.sip !== undefined || payload.agent !== undefined
      ) throw new Error("Meeting token grants exceed participant scope");
      return { url: config.livekitUrl, token: data.token };
    },
  };
}
