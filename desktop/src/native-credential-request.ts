/** Originless native credential request. Node fetch adds Sec-Fetch-Mode and loses Phone11's native bearer grant. */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const MAX_RESPONSE_BYTES = 65536;

export async function postNativeCredential(
  endpoint: string, body: string, signal: AbortSignal, allowHttpLoopbackForTests = false,
): Promise<Response> {
  const url = new URL(endpoint);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.pathname !== "/api/auth/sign-in/email" || url.search || url.hash || url.username || url.password ||
      (url.protocol !== "https:" && !(allowHttpLoopbackForTests && url.protocol === "http:" && loopback))) {
    throw new Error("Invalid native credential endpoint");
  }
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Response>((resolve, reject) => {
    const outgoing = request(url, {
      method: "POST", signal,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-Phone11-Client": "native",
      },
    }, incoming => {
      const chunks: Buffer[] = [];
      let size = 0;
      incoming.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          incoming.destroy(new Error("Credential response too large"));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("aborted", () => reject(new Error("Credential response interrupted")));
      incoming.on("end", () => {
        try {
          const status = incoming.statusCode;
          if (!status || status < 200 || status > 599)
            throw new Error("Invalid credential response status");
          const token = incoming.headers["set-auth-token"];
          if (Array.isArray(token)) throw new Error("Ambiguous native bearer response");
          const headers = new Headers();
          if (token) headers.set("set-auth-token", token);
          const payload = status === 204 || status === 205 || status === 304 ? null : Buffer.concat(chunks);
          resolve(new Response(payload, { status, headers }));
        } catch (error) { reject(error); }
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}
