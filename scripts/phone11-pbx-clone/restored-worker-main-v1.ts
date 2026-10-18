/** Fixed worker launcher seam; no automatic process/service startup on import. */
import { fstatSync, writeSync } from "node:fs";
import { beginCustodianChallenge, CustodianPermitRefusal, readCustodianPermitFromFd, type CustodianAction } from "./custodian-permit-v1";
import { runCustodianSelectedHandler } from "./selected-handler-entry";

/** Supervisor launches one isolated process/action and captures this private pipe only. */
export async function runFixedRestoredWorker(action: CustodianAction, signal: AbortSignal): Promise<Readonly<Record<string, string | boolean>>> {
  try {
    const challenge = beginCustodianChallenge(action, signal); // Unbound anchor refuses before RNG/FD IO.
    if (!fstatSync(0).isFIFO() || !fstatSync(1).isFIFO()) throw new CustodianPermitRefusal("PRIVATE_FD_REFUSED");
    const metadata = Buffer.from(JSON.stringify({ schema: "phone11-restored-worker-private-challenge/v1", nonce: challenge.nonce, action: challenge.action, issuedAtMs: challenge.issuedAtMs, expiresAtMs: challenge.expiresAtMs }) + "\n");
    let offset = 0;
    while (offset < metadata.length) { const written = writeSync(1, metadata, offset); if (written <= 0) throw new CustodianPermitRefusal("PRIVATE_FD_REFUSED"); offset += written; }
    const permit = await readCustodianPermitFromFd(challenge.token, signal);
    return await runCustodianSelectedHandler(permit, signal);
  } catch (error) {
    return Object.freeze({ schema: "phone11-restored-worker-status/v1", outcome: "REFUSED", code: error instanceof CustodianPermitRefusal ? error.code : "UNCLASSIFIED", runtimeAcceptance: false, productionAcceptance: false });
  }
}
