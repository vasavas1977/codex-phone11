/// <reference path="./js-postgres-driver-types.d.ts" />
/** Preserve JS TLS/hostname and public Client.end semantics. pg's root export
 * can select libpq from NODE_PG_FORCE_NATIVE; no configuration reaches a pool
 * unless its constructor matches the explicitly exported pure-JS client.
 */
import pg from "pg";
import JsClient from "pg/lib/client.js";

export function createJsPostgresPool(config: pg.PoolConfig): pg.Pool {
  if (pg.Client !== JsClient) throw new Error("JavaScript database transport is unavailable");
  return new pg.Pool({ ...config, Client: JsClient });
}
