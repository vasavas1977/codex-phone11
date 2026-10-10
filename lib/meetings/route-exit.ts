/** Ensures every route removal stops a live meeting before its controls vanish. */
export function createMeetingRouteExit(
  meeting: { leave(): Promise<void> },
  navigateBack: () => void,
) {
  let leaveTask: Promise<void> | undefined;
  let disposed = false;
  let navigated = false;

  const stop = () => {
    if (!leaveTask) {
      leaveTask = meeting.leave().catch((error) => {
        leaveTask = undefined;
        throw error;
      });
    }
    return leaveTask;
  };

  return {
    async leaveAndNavigate() {
      await stop();
      if (!disposed && !navigated) {
        navigated = true;
        navigateBack();
      }
    },
    dispose() {
      disposed = true;
      void stop().catch(() => undefined);
    },
  };
}
