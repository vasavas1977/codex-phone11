import test from 'node:test';
import assert from 'node:assert/strict';
import { repairFreeSwitchDialogRoute } from '../scripts/phone11-dialog-route-repair.mjs';

const source = `request_route {
    if (has_totag()) {
        if (loose_route()) {
            if (is_method("INVITE")) {
                route(RTPENGINE_MANAGE);
            }
            if (is_method("ACK") && has_body("application/sdp")) {
                route(RTPENGINE_MANAGE);
            }
            route(RELAY);
            exit;
        }
    }
    # CANCEL processing
    route(AUTH);
}
route[RELAY] { t_relay(); }
`;

test('changes only the known FreeSWITCH public next hop inside loose routing', () => {
  const result = repairFreeSwitchDialogRoute(source);
  assert.ok(result.includes('if ($rd == "43.210.122.111" && $rp == 5080)'));
  assert.ok(result.includes('$du = "sip:10.0.1.69:5080";'));
  assert.ok(result.endsWith(source.slice(source.indexOf('    # CANCEL processing'))));
  assert.equal((result.match(/route\(RTPENGINE_MANAGE\)/g) || []).length, 2);
  assert.equal(repairFreeSwitchDialogRoute(result), result);
});

test('refuses missing guards, changed anchors, and conflicting prior repairs', () => {
  assert.throws(() => repairFreeSwitchDialogRoute(source.replace('if (loose_route()) {', 'if (true) {')));
  assert.throws(() => repairFreeSwitchDialogRoute(source.replace('route(RELAY);', 'route(OTHER);')));
  assert.throws(() => repairFreeSwitchDialogRoute(repairFreeSwitchDialogRoute(source).replace('sip:10.0.1.69:5080', 'sip:other:5080')));
});
