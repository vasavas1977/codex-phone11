/** Generated in-memory transport only. No browser, network, storage or app auth imports. */
const TENANTS = [801, 802];
const ACCOUNTS = { A: { id: 101, name: 'Generated account A' }, B: { id: 202, name: 'Generated account B' } };
export function createFixtureModel(wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let identity = 1, revision = 1, readSequence = 0, operation = 0;
  const policies = new Map();
  const listeners = new Set(), authListeners = new Set();
  let state = { user: { ...ACCOUNTS.A }, account: 'A', authIdentity: identity, tenantId: 801,
    scopeKey: 'fixture-1', supported: true, revoked: false, mutationPending: false,
    query: { data: undefined, isLoading: true, isFetching: false, isError: false, isSuccess: false },
    nextReadFails: false, nextSaveFails: false, nextSaveSlow: false, nextReadbackMismatch: false,
    event: 'Generated fixture ready; no real accounts or services are used.' };
  const emit = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const capture = () => ({ user: state.user, identity: state.authIdentity, tenantId: state.tenantId, scopeKey: state.scopeKey });
  const current = scope => scope.user === state.user && scope.identity === state.authIdentity &&
    scope.tenantId === state.tenantId && scope.scopeKey === state.scopeKey && !state.revoked && state.supported;
  const key = scope => `${scope.user.id}:${scope.tenantId}`;
  const observation = (scope, value) => ({ ownerId: scope.user.id, authIdentity: scope.identity,
    tenantId: scope.tenantId, admissionScope: scope.scopeKey, configured: value !== undefined,
    internationalEnabled: value?.internationalEnabled === true, premiumRateEnabled: value?.premiumRateEnabled === true });
  function reset(patch, authChanged = false) {
    readSequence++;
    state = { ...state, ...patch, scopeKey: `fixture-${++revision}`,
      query: { data: undefined, isLoading: true, isFetching: false, isError: false, isSuccess: false } };
    if (authChanged) for (const listener of authListeners) listener();
    for (const listener of listeners) listener();
  }
  async function load() {
    const scope = capture(), sequence = ++readSequence;
    if (!current(scope)) {
      emit({ query: { data: undefined, isLoading: false, isFetching: false, isError: true, isSuccess: false } });
      return { isError: true, data: undefined };
    }
    const fails = state.nextReadFails;
    emit({ nextReadFails: false, query: { ...state.query, isLoading: !state.query.data, isFetching: true, isError: false } });
    await wait(350);
    if (!current(scope) || sequence !== readSequence) return { isError: true, data: undefined };
    if (fails) {
      emit({ event: 'Generated read failure; refresh to retry.', query: { data: undefined,
        isLoading: false, isFetching: false, isError: true, isSuccess: false } });
      return { isError: true, data: undefined };
    }
    const data = observation(scope, policies.get(key(scope)));
    emit({ query: { data, isLoading: false, isFetching: false, isError: false, isSuccess: true },
      event: 'Generated read completed for the selected account and workspace.' });
    return { isError: false, data };
  }
  async function mutate(input) {
    const scope = capture();
    if (!current(scope) || state.mutationPending || input?.tenantId !== scope.tenantId ||
        Object.keys(input).sort().join(',') !== 'internationalEnabled,premiumRateEnabled,tenantId' ||
        typeof input.internationalEnabled !== 'boolean' || typeof input.premiumRateEnabled !== 'boolean')
      throw new Error('FIXTURE_WRITE_REFUSED');
    const request = ++operation, fails = state.nextSaveFails, slow = state.nextSaveSlow,
      mismatch = state.nextReadbackMismatch;
    emit({ mutationPending: true, nextSaveFails: false, nextSaveSlow: false, nextReadbackMismatch: false,
      event: slow ? 'Generated save delayed for scope-switch testing.' : 'Generated save in progress.' });
    try {
      await wait(slow ? 2500 : 350);
      if (!current(scope) || fails) throw new Error('FIXTURE_WRITE_REFUSED');
      policies.set(key(scope), mismatch ? { internationalEnabled: !input.internationalEnabled,
        premiumRateEnabled: input.premiumRateEnabled } : { internationalEnabled: input.internationalEnabled,
        premiumRateEnabled: input.premiumRateEnabled });
      emit({ event: mismatch ? 'Generated mismatching readback armed.' : 'Generated save acknowledged; real component must read back.' });
      return { success: true };
    } finally { if (request === operation) emit({ mutationPending: false }); }
  }
  return {
    snapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeAuth: listener => { authListeners.add(listener); return () => authListeners.delete(listener); },
    load, mutate,
    chooseTenant(id) { if (!TENANTS.includes(id)) throw new Error('FIXTURE_TENANT_REFUSED'); reset({ tenantId: id }); },
    chooseAccount(account) {
      if (!Object.hasOwn(ACCOUNTS, account)) throw new Error('FIXTURE_ACCOUNT_REFUSED');
      reset({ account, user: { ...ACCOUNTS[account] }, authIdentity: ++identity }, true);
    },
    reauthenticate() { reset({ user: { ...ACCOUNTS[state.account] }, authIdentity: ++identity }, true); },
    setRevoked(revoked) { if (typeof revoked !== 'boolean') throw new Error('FIXTURE_INPUT_REFUSED'); reset({ revoked }); },
    setSupported(supported) { if (typeof supported !== 'boolean') throw new Error('FIXTURE_INPUT_REFUSED'); reset({ supported }); },
    arm(name) {
      if (!['nextReadFails','nextSaveFails','nextSaveSlow','nextReadbackMismatch'].includes(name)) throw new Error('FIXTURE_SCENARIO_REFUSED');
      emit({ [name]: true, event: 'Generated one-shot scenario armed.' });
    },
  };
}
