// Restrict this repair to the two observed, redundant native answer rewrites.
export function repairNativeSdpAnswer(source) {
  const start = source.indexOf('onreply_route[FREESWITCH_REPLY] {');
  const end = source.indexOf('# ---- Failure Route ----', start);
  if (start < 0 || end < 0) throw new Error('Expected FreeSWITCH reply route not found');
  let route = source.slice(start, end);
  const anchors = [
    'if ($avp(phone11_media_profile) == "native" && $rb =~ ',
    'if ($avp(phone11_media_profile) == "native" && has_body("application/sdp")) {',
  ];
  const markers = ['FORCED_PUBLIC_NATIVE_ANSWER_SDP public_media_ip=', 'FORCED_PUBLIC_NATIVE_ANSWER_SDP_V5 public_media_ip='];
  if (markers.every(marker => !route.includes(marker)) && !route.includes('subst_body(')) return source;
  if (!route.includes('media-address=43.210.122.111')) throw new Error('RTPEngine public media address missing');
  for (let i = 0; i < anchors.length; i++) {
    const a = route.indexOf(anchors[i]);
    const b = route.indexOf('}', a);
    if (a < 0 || b < a) throw new Error('Native answer substitution block changed');
    const block = route.slice(a, b + 1);
    if (!block.includes(markers[i]) || !block.includes("subst_body('/10\\.0\\.1\\.69/43.210.122.111/g');") || block.includes('rtpengine_')) {
      throw new Error('Unexpected native answer block; refusing repair');
    }
    route = route.slice(0, a) + route.slice(b + 1);
  }
  if (route.includes('subst_body(')) throw new Error('Additional body rewrite requires review');
  return source.slice(0, start) + route + source.slice(end);
}
