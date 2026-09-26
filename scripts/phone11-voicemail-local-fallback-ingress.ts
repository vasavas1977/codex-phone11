#!/usr/bin/env node
/** Redeem one local fallback reference before Lua can admit or answer a call.
 * No SIP identity, tenant, mailbox, URL, or secret is accepted from a caller.
 * The one-use response is handed to the same FreeSWITCH process in a private
 * channel-UUID file; the existing producer owns admission and completion.
 */
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REF = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_ID = /^[A-Za-z0-9._~+@:-]{1,160}$/;
const FROM_TAG = /^[A-Za-z0-9._~+-]{1,96}$/;
const EXTENSION = /^[1-9][0-9]{0,15}$/;
const DOMAIN = /^(?=.{1,128}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const MAX_INPUT = 2048;
const MAX_REPLY = 4096;

export type RedemptionInput = { reference: string; callId: string; fromTag: string; channelUuid: string };
export type CanonicalMailbox = { channelUuid: string; tenantId: number; extension: string; account: string; domain: string; expectedOwnerEpoch: string };
export type IngressConfig = { apiBase: string; integrationSecret: string; handoffRoot: string };

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const found = Object.keys(value);
  return found.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function endpoint(config: IngressConfig): URL {
  if (typeof config.integrationSecret !== "string" || config.integrationSecret.length < 32 ||
      /[\r\n\0]/.test(config.integrationSecret)) throw new Error("Invalid fallback configuration");
  if (typeof config.handoffRoot !== "string" || !path.isAbsolute(config.handoffRoot))
    throw new Error("Invalid fallback configuration");
  const url = new URL(config.apiBase);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
      !["3012", "3013"].includes(url.port) ||
      url.pathname !== "/api/voicemail/local-fallback" ||
      url.username || url.password || url.search || url.hash)
    throw new Error("Invalid fallback configuration");
  url.pathname += "/redeem";
  return url;
}

function validateInput(input: unknown): asserts input is RedemptionInput {
  if (!exactObject(input, ["reference", "callId", "fromTag", "channelUuid"]) ||
      typeof input.reference !== "string" || !REF.test(input.reference) ||
      typeof input.callId !== "string" || !CALL_ID.test(input.callId) ||
      typeof input.fromTag !== "string" || !FROM_TAG.test(input.fromTag) ||
      typeof input.channelUuid !== "string" || !UUID.test(input.channelUuid))
    throw new Error("Invalid fallback identity");
}

function mailbox(value: unknown, channelUuid: string): CanonicalMailbox {
  if (!exactObject(value, ["identity", "expectedOwnerEpoch"]) ||
      !exactObject(value.identity, ["tenantId", "caller", "target"]) ||
      !positiveId(value.identity.tenantId) ||
      !exactObject(value.identity.caller, ["extensionId", "userId", "sipUsername", "sipDomain"]) ||
      !positiveId(value.identity.caller.extensionId) || !positiveId(value.identity.caller.userId) ||
      typeof value.identity.caller.sipUsername !== "string" ||
      typeof value.identity.caller.sipDomain !== "string" ||
      !exactObject(value.identity.target,
        ["extensionId", "ownerUserId", "ownerEpoch", "extensionNumber", "sipUsername", "sipDomain"]) ||
      !positiveId(value.identity.target.extensionId) || !positiveId(value.identity.target.ownerUserId) ||
      typeof value.identity.target.extensionNumber !== "string" || !EXTENSION.test(value.identity.target.extensionNumber) ||
      value.identity.target.sipUsername !== value.identity.target.extensionNumber ||
      typeof value.identity.target.sipDomain !== "string" || !DOMAIN.test(value.identity.target.sipDomain) ||
      typeof value.expectedOwnerEpoch !== "string" || !UUID.test(value.expectedOwnerEpoch) ||
      value.identity.target.ownerEpoch !== value.expectedOwnerEpoch)
    throw new Error("Invalid fallback authority response");
  return { channelUuid, tenantId: value.identity.tenantId,
    extension: value.identity.target.extensionNumber,
    account: value.identity.target.sipUsername,
    domain: value.identity.target.sipDomain,
    expectedOwnerEpoch: value.expectedOwnerEpoch };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Empty fallback response");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_REPLY) throw new Error("Oversized fallback response");
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

/** Consumes the reference even if the response is later rejected. */
export async function redeemLocalFallback(config: IngressConfig, input: unknown,
                                           send: typeof fetch = fetch): Promise<CanonicalMailbox> {
  const url = endpoint(config);
  validateInput(input);
  const response = await send(url, {
    method: "POST", headers: { "content-type": "application/json", "x-fs-secret": config.integrationSecret },
    body: JSON.stringify({ reference: input.reference, callId: input.callId, fromTag: input.fromTag }),
    signal: AbortSignal.timeout(3000),
  });
  if (response.status !== 200) throw new Error("Fallback redemption denied");
  return mailbox(await boundedJson(response), input.channelUuid);
}

async function privateRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const st = await lstat(root);
  if (!st.isDirectory() || (st.mode & 0o077) !== 0) throw new Error("Fallback handoff is not private");
}

/** One handoff per FS channel, with no replacement or following symlinks. */
export async function publishHandoff(root: string, canonical: CanonicalMailbox): Promise<void> {
  if (!UUID.test(canonical.channelUuid) || !positiveId(canonical.tenantId) ||
      !EXTENSION.test(canonical.extension) || canonical.account !== canonical.extension ||
      !DOMAIN.test(canonical.domain) || !UUID.test(canonical.expectedOwnerEpoch))
    throw new Error("Invalid canonical fallback handoff");
  await privateRoot(root);
  const file = path.join(root, `${canonical.channelUuid}.ready`);
  const data = [canonical.tenantId, canonical.extension, canonical.account,
    canonical.domain, canonical.expectedOwnerEpoch].join("\n") + "\n";
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}

async function readStdin(): Promise<unknown> {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > MAX_INPUT) throw new Error("Oversized fallback input");
  }
  return JSON.parse(raw);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    const config = { apiBase: process.env.PHONE11_VOICEMAIL_FALLBACK_API_BASE || "",
      integrationSecret: process.env.FS_SHARED_SECRET || "",
      handoffRoot: process.env.PHONE11_VOICEMAIL_FALLBACK_HANDOFF_ROOT || "" };
    const result = await redeemLocalFallback(config, await readStdin());
    await publishHandoff(config.handoffRoot, result);
  })().catch(() => { process.stderr.write("Local fallback unavailable\n"); process.exitCode = 1; });
}
