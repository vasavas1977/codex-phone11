const anchor = `            if (is_method("ACK") && has_body("application/sdp")) {
                route(RTPENGINE_MANAGE);
            }
            route(RELAY);
            exit;`;

const insertion = `            # phone11-private-freeswitch-dialog: avoid the EC2 public-IP hairpin.
            if ($rd == "43.210.122.111" && $rp == 5080) {
                $du = "sip:10.0.1.69:5080";
            }
`;

export function repairFreeSwitchDialogRoute(source) {
  const start = source.indexOf('    if (has_totag()) {');
  const end = source.indexOf('    # CANCEL processing', start);
  if (start < 0 || end < 0) throw new Error('Expected in-dialog route not found');
  const route = source.slice(start, end);
  if (!route.includes('if (loose_route()) {')) throw new Error('Loose-route guard missing');
  if (route.includes('phone11-private-freeswitch-dialog:')) {
    if (!route.includes(insertion)) throw new Error('Existing dialog repair differs');
    return source;
  }
  if (route.split(anchor).length !== 2) throw new Error('In-dialog relay anchor changed');
  const replacement = anchor.replace('            route(RELAY);', insertion + '            route(RELAY);');
  return source.slice(0, start) + route.replace(anchor, replacement) + source.slice(end);
}
