import { describe, expect, it, vi } from "vitest";

import { createMeetingRouteExit } from "./route-exit";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("meeting route exit", () => {
  it("stops media when navigation removes a meeting screen", async () => {
    const pending = deferred();
    const meeting = { leave: vi.fn(() => pending.promise) };
    const navigate = vi.fn();
    const exit = createMeetingRouteExit(meeting, navigate);

    exit.dispose();
    exit.dispose();
    expect(meeting.leave).toHaveBeenCalledTimes(1);
    pending.resolve();
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leaves before navigating and shares one cleanup task", async () => {
    const pending = deferred();
    const meeting = { leave: vi.fn(() => pending.promise) };
    const navigate = vi.fn();
    const exit = createMeetingRouteExit(meeting, navigate);

    const first = exit.leaveAndNavigate();
    const second = exit.leaveAndNavigate();
    expect(navigate).not.toHaveBeenCalled();
    expect(meeting.leave).toHaveBeenCalledTimes(1);
    pending.resolve();
    await Promise.all([first, second]);
    expect(navigate).toHaveBeenCalledTimes(1);
    exit.dispose();
    expect(meeting.leave).toHaveBeenCalledTimes(1);
  });
});
