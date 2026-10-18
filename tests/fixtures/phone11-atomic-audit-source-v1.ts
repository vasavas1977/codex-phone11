/** Exact reviewed atomic-audit source delta only. Not a runtime/build contract.
 * Historical selected v2 remains immutable and unadmitted for these bytes.
 */
export const ATOMIC_AUDIT_SOURCE_FIXTURE = Object.freeze({
  sourceRevision: "e9f5831de8d3ef27f628cfdeb4ad57369ba01dc9",
  graphSha256: "7d8ae2adf82938879487bccdbd04560e3a5f36fe5893b616fbe466087e2e5c40",
  runtimeAuthority: false,
  updates: Object.freeze([
  {
    "path": "server/pbx/ivr-router.ts",
    "historicalSha256": "c4346a33f2826bc37d52f916a3c37eaf31cf65955d2a5a70cd535347aad52eef",
    "sha256": "cfb6f16e3f77289041a0b950b22a750d3924bad3181dd8d505eeb5489520b4b3"
  },
  {
    "path": "server/pbx/audit.ts",
    "historicalSha256": "0b58fa8a75c534c6900140414af2f8e960b0f7ae6a4a25618a0f0788dfd8e94d",
    "sha256": "60bd5224f3a55ea40e06e69911637c61134a419cc2bdac928644a5afb5d40e84"
  }
].map(pin => Object.freeze(pin))),
});
