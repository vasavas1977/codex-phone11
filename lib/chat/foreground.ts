/** One foreground list refresh for all tabs; never marks any message read. */
export function startChatForegroundRefresh(deps: {
  auth: () => { user: { id: number } | null; loading: boolean };
  onAuth: (listener: () => void) => () => void;
  active: () => boolean;
  onActivity: (listener: () => void) => () => void;
  state: () => {
    userId: number | null;
    setUser(id: number | null): void;
    loadChannels(): Promise<void>;
    cancelChannelRefresh(): void;
  };
}) {
  let stopped = false;
  let owner = deps.auth().user;
  let loading = deps.auth().loading;
  let active = deps.active();
  const refresh = () => {
    const auth = deps.auth();
    if (stopped || !deps.active() || !auth.user || auth.loading || auth.user !== owner) return;
    const state = deps.state();
    if (state.userId !== auth.user.id) return;
    // Omit tenantId deliberately: the store owns the selected (or pending)
    // workspace. A delayed timer must never restore an earlier selection.
    void state.loadChannels().catch(() => { /* Store reports refresh failures. */ });
  };
  const sync = () => {
    if (stopped) return;
    const auth = deps.auth(), nextActive = deps.active();
    if (auth.user !== owner || auth.loading !== loading || nextActive !== active) {
      deps.state().cancelChannelRefresh();
      owner = auth.user; loading = auth.loading; active = nextActive;
      deps.state().setUser(owner?.id ?? null);
      refresh();
    }
  };
  const offAuth = deps.onAuth(sync), offActivity = deps.onActivity(sync);
  deps.state().setUser(owner?.id ?? null);
  refresh();
  const timer = setInterval(refresh, 5000);
  return () => {
    stopped = true; clearInterval(timer); offAuth(); offActivity();
    deps.state().cancelChannelRefresh();
  };
}
