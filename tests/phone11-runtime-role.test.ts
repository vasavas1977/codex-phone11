import { describe, expect, it, vi } from "vitest";

import {
  createPhone11RuntimeLifecycle,
  createPhone11RuntimePlan,
  parsePhone11RuntimePort,
  selectPhone11RuntimePort,
  type Phone11BackgroundServices,
} from "../server/_core/runtime-role";

function services() {
  const stopped = {
    chatMedia: vi.fn(),
    recordingAnalysis: vi.fn(),
    recordingRetention: vi.fn(),
    recordingCapture: vi.fn(),
  };
  const service: Phone11BackgroundServices = {
    startChatNotificationDispatcher: vi.fn(),
    startChatMediaRetention: vi.fn(() => stopped.chatMedia),
    startRecordingAnalysis: vi.fn(() => stopped.recordingAnalysis),
    startRecordingRetention: vi.fn(() => stopped.recordingRetention),
    startRecordingCapture: vi.fn(() => stopped.recordingCapture),
    startFreeSwitchEventListener: vi.fn(),
    stopFreeSwitchEventListener: vi.fn(),
    shutdownWebSockets: vi.fn(),
  };
  return { service, stopped };
}

describe("Phone11 runtime roles", () => {
  it("keeps the default role's background lifecycle and legacy available-port selection", async () => {
    const { service, stopped } = services();
    const runtime = createPhone11RuntimeLifecycle(undefined, service);
    const findAvailablePort = vi.fn(async (port: number) => port + 1);

    expect(runtime.plan).toEqual({
      role: "default",
      startsBackgroundServices: true,
      bindsPortExactly: false,
    });
    expect(parsePhone11RuntimePort(runtime.plan, undefined)).toBe(3000);
    expect(parsePhone11RuntimePort(runtime.plan, "3000legacy")).toBe(3000);
    expect(
      await selectPhone11RuntimePort(runtime.plan, 3000, findAvailablePort),
    ).toBe(3001);
    expect(findAvailablePort).toHaveBeenCalledWith(3000);

    runtime.background.start();
    expect(service.startChatNotificationDispatcher).toHaveBeenCalledOnce();
    expect(service.startChatMediaRetention).toHaveBeenCalledOnce();
    expect(service.startRecordingAnalysis).toHaveBeenCalledOnce();
    expect(service.startRecordingRetention).toHaveBeenCalledOnce();
    expect(service.startRecordingCapture).toHaveBeenCalledOnce();
    expect(service.startFreeSwitchEventListener).toHaveBeenCalledOnce();

    runtime.background.stop();
    expect(stopped.chatMedia).toHaveBeenCalledOnce();
    expect(stopped.recordingAnalysis).toHaveBeenCalledOnce();
    expect(stopped.recordingRetention).toHaveBeenCalledOnce();
    expect(stopped.recordingCapture).toHaveBeenCalledOnce();
    expect(service.stopFreeSwitchEventListener).toHaveBeenCalledOnce();
    expect(service.shutdownWebSockets).toHaveBeenCalledOnce();
  });

  it("keeps an API candidate API-only, on the exact requested port", async () => {
    const { service, stopped } = services();
    const runtime = createPhone11RuntimeLifecycle("api-candidate", service);
    const findAvailablePort = vi.fn(async (port: number) => port + 1);

    expect(runtime.plan).toEqual({
      role: "api-candidate",
      startsBackgroundServices: false,
      bindsPortExactly: true,
    });
    expect(parsePhone11RuntimePort(runtime.plan, "3002")).toBe(3002);
    expect(
      await selectPhone11RuntimePort(runtime.plan, 3002, findAvailablePort),
    ).toBe(3002);
    expect(findAvailablePort).not.toHaveBeenCalled();

    runtime.background.start();
    runtime.background.stop();
    for (const effect of [
      service.startChatNotificationDispatcher,
      service.startChatMediaRetention,
      service.startRecordingAnalysis,
      service.startRecordingRetention,
      service.startRecordingCapture,
      service.startFreeSwitchEventListener,
      service.stopFreeSwitchEventListener,
      service.shutdownWebSockets,
      stopped.chatMedia,
      stopped.recordingAnalysis,
      stopped.recordingRetention,
      stopped.recordingCapture,
    ]) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("rejects an unknown role before any background effect can run", () => {
    const { service } = services();

    expect(() =>
      createPhone11RuntimeLifecycle("candidate-ish", service),
    ).toThrow(
      'Invalid PHONE11_RUNTIME_ROLE "candidate-ish". Expected "default" or "api-candidate".',
    );
    for (const effect of Object.values(service)) {
      expect(effect).not.toHaveBeenCalled();
    }
    expect(() => createPhone11RuntimePlan("DEFAULT")).toThrow(
      /Invalid PHONE11_RUNTIME_ROLE/,
    );
    for (const role of ["", " ", " api-candidate", "api-candidate "]) {
      expect(() => createPhone11RuntimePlan(role)).toThrow(
        /Invalid PHONE11_RUNTIME_ROLE/,
      );
    }
  });

  it("requires an explicit strict candidate port", () => {
    const plan = createPhone11RuntimePlan("api-candidate");

    for (const port of [
      undefined,
      "",
      " ",
      "0",
      "03002",
      "3002junk",
      "3002 ",
      "+3002",
      "65536",
    ]) {
      expect(() => parsePhone11RuntimePort(plan, port)).toThrow(
        /Invalid PORT/,
      );
    }
    expect(parsePhone11RuntimePort(plan, "1")).toBe(1);
    expect(parsePhone11RuntimePort(plan, "65535")).toBe(65535);
  });
});
