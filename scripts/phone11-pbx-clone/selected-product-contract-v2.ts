/** Reviewed product source revision only; grants no build, fixture or execution admission. */
export const SELECTED_PRODUCT_SOURCE = "5ee87227983d0d7dc039d148102d53b35f0821dd";
export const SELECTED_PRODUCT_PINS = Object.freeze([
  {
    "path": "server/pbx/ivr-router.ts",
    "sha256": "c4346a33f2826bc37d52f916a3c37eaf31cf65955d2a5a70cd535347aad52eef"
  },
  {
    "path": "server/_core/trpc.ts",
    "sha256": "0fd486ef9810a38b1d9f90df512846fc874553c8a17decf4a26fed006cd4c92b"
  },
  {
    "path": "shared/const.ts",
    "sha256": "d9fedf20dc67e22f79ee6c624e613fdbc16e2cc7db872201f89ffbad7f5c163b"
  },
  {
    "path": "server/pbx/db.ts",
    "sha256": "73c37d847f23b5a6d33507c62dc666dbc8e601a09f306ba539d1de333b5b3709"
  },
  {
    "path": "server/pbx/audit.ts",
    "sha256": "0b58fa8a75c534c6900140414af2f8e960b0f7ae6a4a25618a0f0788dfd8e94d"
  },
  {
    "path": "server/pbx/redis.ts",
    "sha256": "4717c592961c5065fdc8cd933897110c5ee9537850a791e15291bf26b1ddbf49"
  },
  {
    "path": "server/pbx/tenant-middleware.ts",
    "sha256": "d148fcd4425e09cbc04143f8dd853e162b6b65cb548aecd685ffb30d26fcd879"
  },
  {
    "path": "server/pbx/schema-capabilities.ts",
    "sha256": "508b38df0398f83fe6200f301d59db6c5f3a0939ea258cc3e864e4a47936fb29"
  },
  {
    "path": "server/phone-provisioning.ts",
    "sha256": "18513fafedae1e85baa07b386e55eb3f329ed5ecb4b620cc34cd947c63617ac0"
  },
  {
    "path": "server/pbx/sip-secrets.ts",
    "sha256": "dd848b73dfc8b566e2dc4d5cd32167be5b352a58ca6280c8cfe91053c6324859"
  }
].map(pin => Object.freeze(pin)));
export const SELECTED_BUILD_CONTRACT = Object.freeze({
  schema: "phone11-pbx-selected-build/v2",
  sourceCommit: SELECTED_PRODUCT_SOURCE,
  graphSha256: "e81ae5036b7b073d47b38fc15805c856ba5039f71f4d49e43ea5f3c40877f3c6",
  adapterSha256: "3a82401460aa46622b1a155f9b073b0e8ddbb1719ddcc7de665b358a548d8a08",
  databaseAlias: "scripts/phone11-pbx-clone/selected-resource-bridge.ts",
  redisTransportAlias: "scripts/phone11-pbx-clone/selected-resource-bridge.ts",
});
