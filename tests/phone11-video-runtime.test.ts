import { beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  platform: { OS: "ios" },
  modules: {} as Record<string, unknown>,
  view: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: runtime.platform,
  NativeModules: runtime.modules,
  UIManager: { getViewManagerConfig: runtime.view },
}));
import { getVideoBridge } from "../lib/sip/video-runtime";
const supported = () => ({
  getVideoCapabilities: vi.fn(async () => ({
    oneToOne: true,
    nativeView: true,
    cameraMute: true,
    cameraSwitch: true,
  })),
  requestCameraPermission: vi.fn(),
  makeVideoCall: vi.fn(),
  prepareVideoAnswer: vi.fn(),
  cancelVideoAnswer: vi.fn(),
  setCameraMuted: vi.fn(),
  switchCamera: vi.fn(),
});
beforeEach(() => {
  vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", "siprix");
  runtime.platform.OS = "ios";
  runtime.view.mockReset().mockReturnValue({});
  runtime.modules.Phone11Siprix = supported();
});
describe("installed video capability", () => {
  it("rejects an older binary without invoking missing methods", async () => {
    runtime.modules.Phone11Siprix = { makeCall: vi.fn() };
    expect(await getVideoBridge()).toBeNull();
  });
  it("rejects missing native renderer", async () => {
    runtime.view.mockReturnValue(null);
    expect(await getVideoBridge()).toBeNull();
  });
  it("rejects Android and web until native support exists", async () => {
    for (const os of ["android", "web"]) {
      runtime.platform.OS = os;
      expect(await getVideoBridge()).toBeNull();
    }
  });
  it("rejects a different engine even if the native module exists", async () => {
    vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", "pjsip");
    expect(await getVideoBridge()).toBeNull();
  });
  it("requires affirmative capability response", async () => {
    const bridge = supported();
    bridge.getVideoCapabilities.mockResolvedValue({
      oneToOne: false,
      nativeView: true,
      cameraMute: true,
      cameraSwitch: true,
    });
    runtime.modules.Phone11Siprix = bridge;
    expect(await getVideoBridge()).toBeNull();
  });
  it("returns the bridge only when methods, renderer and capability agree", async () => {
    expect(await getVideoBridge()).toBe(runtime.modules.Phone11Siprix);
  });
});
