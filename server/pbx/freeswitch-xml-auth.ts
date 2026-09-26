import type { RequestHandler } from "express";
import { integrationSecretStatus } from "./integration-auth";

const username = "phone11-freeswitch";
const secretField = /^(?:secret|fs[-_]?secret|fs[-_]?shared[-_]?secret|x[-_]?fs[-_]?secret|authorization)$/i;
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function basicSecret(authorization: unknown): string | undefined {
  if (typeof authorization !== "string" || authorization.length > 5600) return;
  const match = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(authorization);
  if (!match || !base64.test(match[1])) return;
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.toString("base64") !== match[1]) return;
  try {
    const credentials = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const prefix = `${username}:`;
    return credentials.startsWith(prefix) ? credentials.slice(prefix.length) : undefined;
  } catch {
    return;
  }
}

/** Only mod_xml_curl directory and dialplan accept gateway-credentials Basic. */
export const requireXmlCurlAuth: RequestHandler = (req, res, next) => {
  if (integrationSecretStatus("FS_SHARED_SECRET", undefined) === "unavailable") {
    res.status(503).json({ error: "Integration is not configured" });
    return;
  }
  const headerCount = (name: string) => req.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length;
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  if (headerCount("authorization") > 1 || headerCount("x-fs-secret") > 1 ||
      (req.headers.authorization !== undefined && req.headers["x-fs-secret"] !== undefined) ||
      [...Object.keys(req.query), ...Object.keys(body)].some((key) => secretField.test(key))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const supplied = req.headers.authorization === undefined
    ? req.headers["x-fs-secret"] : basicSecret(req.headers.authorization);
  if (integrationSecretStatus("FS_SHARED_SECRET", supplied) !== "ok") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
};
