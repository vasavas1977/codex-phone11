declare module "phone11-maintained/db" {
  export { configureOwnedPbxPool, getPool, closeOwnedPbxPool } from "../../server/pbx/db";
  export type { OwnedPbxPoolBinding } from "../../server/pbx/db";
}
declare module "phone11-maintained/pool-attestation" {
  export interface DatabaseAuthority { roleOid: number; databaseOid: number; clientAddress: string; serverAddress: string; serverPort: number; }
  export function requiredAuthority(value: DatabaseAuthority): Readonly<DatabaseAuthority>;
  export function attestOwnedPool(role: string, database: string, authority: Readonly<DatabaseAuthority>): Promise<void>;
}
