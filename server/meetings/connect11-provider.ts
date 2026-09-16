import type { MeetingGrant, MeetingProvider } from "./service";

/**
 * A server-only resolver that converts an authorized Phone11 grant into the
 * opaque Connect11 admission. It is deliberately injected: this module does
 * not derive rooms, identities, languages, roles, or consent from client
 * input.
 */
export interface Connect11AdmissionResolver {
  resolve(grant: MeetingGrant): Promise<unknown>;
}

/** Narrow surface of the versioned Connect11 facade used by Phone11. */
export interface Connect11AdmissionClient {
  admit(admission: unknown): Promise<{ rtc_url: string; access_token: string }>;
}

/**
 * Maps a trusted Connect11 conference admission to Phone11's existing media
 * provider interface. It is unmounted until the Connect11 deployment,
 * issuer-isolation, worker, and device acceptance gates are proven.
 */
export function createConnect11MeetingProvider(
  client: Connect11AdmissionClient,
  resolver: Connect11AdmissionResolver,
): MeetingProvider {
  return {
    async join(grant) {
      const admission = await resolver.resolve(grant);
      const token = await client.admit(admission);
      return { url: token.rtc_url, token: token.access_token };
    },
  };
}
