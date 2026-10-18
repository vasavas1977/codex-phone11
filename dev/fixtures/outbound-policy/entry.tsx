import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { OutboundCallPolicy } from "../../../components/admin/outbound-call-policy";
import { fixture, useFixture } from "./boundary";
function FixtureApp() {
  const s = useFixture();
  useEffect(() => { void fixture.load(); }, [s.scopeKey]);
  return <main>
    <h1>Generated outbound policy fixture</h1>
    <p>This is the real Phone11 policy component with in-memory fake transport. Nothing here changes a real workspace, calls a number, or proves production readiness. Reload resets all generated state.</p>
    <section className="harness" aria-label="Generated fixture controls">
      <label>Generated workspace <select value={s.tenantId} onChange={e => fixture.chooseTenant(Number(e.target.value))}>
        <option value="801">Generated workspace One</option><option value="802">Generated workspace Two</option>
      </select></label>
      <label>Generated account <select value={s.account} onChange={e => fixture.chooseAccount(e.target.value)}>
        <option value="A">Generated account A</option><option value="B">Generated account B</option>
      </select></label>
      <button onClick={() => fixture.reauthenticate()}>Reauthenticate same generated account</button>
      <button onClick={() => fixture.setRevoked(!s.revoked)}>{s.revoked ? 'Restore generated access' : 'Revoke generated access'}</button>
      <button onClick={() => fixture.setSupported(!s.supported)}>{s.supported ? 'Simulate old API' : 'Restore supported API'}</button>
      <button onClick={() => fixture.arm('nextReadFails')}>Fail next generated read</button>
      <button onClick={() => fixture.arm('nextSaveFails')}>Fail next generated save</button>
      <button onClick={() => fixture.arm('nextReadbackMismatch')}>Mismatch next generated readback</button>
      <button onClick={() => fixture.arm('nextSaveSlow')}>Delay next generated save</button>
      <p role="status">{s.event}</p>
    </section>
    <OutboundCallPolicy />
  </main>;
}
createRoot(document.getElementById('fixture-root')!).render(<FixtureApp />);
