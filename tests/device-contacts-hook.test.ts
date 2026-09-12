import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  active: "background",
  effect: null as null | (() => void | (() => void)),
  snapshot: null as null | (() => any),
  callbacks: new Set<(state: string) => void>(),
  getPermission: vi.fn(),
  requestPermission: vi.fn(),
  read: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    m.effect = effect;
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => any) => {
    m.snapshot = snapshot;
    return snapshot();
  },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    get currentState() {
      return m.active;
    },
    addEventListener: (_name: string, fn: (state: string) => void) => {
      m.callbacks.add(fn);
      return { remove: () => m.callbacks.delete(fn) };
    },
  },
}));
vi.mock("expo-contacts", () => ({
  getPermissionsAsync: m.getPermission,
  requestPermissionsAsync: m.requestPermission,
  getContactsAsync: m.read,
  Fields: { PhoneNumbers: "phoneNumbers" },
}));
import { useDeviceContacts } from "../hooks/use-device-contacts";
const granted = { granted: true, status: "granted", accessPrivileges: "all" };
const unknown = {
  granted: false,
  status: "undetermined",
  accessPrivileges: "none",
};
const page = {
  data: [
    { id: "1", name: "Local friend", phoneNumbers: [{ number: "0825826667" }] },
  ],
  hasNextPage: false,
};
const cleanups: (() => void)[] = [];
function mount() {
  const hook = useDeviceContacts();
  const off = m.effect!();
  if (off) cleanups.push(off);
  return hook;
}
function state(next: string) {
  m.active = next;
  m.callbacks.forEach((fn) => fn(next));
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.resetAllMocks();
  m.active = "background";
  m.getPermission.mockResolvedValue(granted);
  m.requestPermission.mockResolvedValue(granted);
  m.read.mockResolvedValue(page);
});
afterEach(() => {
  cleanups.splice(0).forEach((off) => off());
  expect(m.callbacks.size).toBe(0);
});
it("does no contacts work on a PushKit background mount or background refresh; reads only on foreground and clears on background", async () => {
  const hook = mount();
  await hook.refresh(true);
  await settle();
  expect(m.getPermission).not.toHaveBeenCalled();
  expect(m.requestPermission).not.toHaveBeenCalled();
  expect(m.read).not.toHaveBeenCalled();
  state("active");
  await settle();
  expect(m.read).toHaveBeenCalledOnce();
  expect(m.snapshot!().people[0].name).toBe("Local friend");
  expect(m.requestPermission).not.toHaveBeenCalled();
  state("background");
  expect(m.snapshot!().people).toEqual([]);
});
it("a permission prompt may suspend the app; its late result cannot repopulate contacts until a fresh active read", async () => {
  m.active = "active";
  m.getPermission.mockResolvedValue(unknown);
  const hook = mount();
  await settle();
  expect(m.read).not.toHaveBeenCalled();
  let finish!: (value: typeof granted) => void;
  m.requestPermission.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const request = hook.refresh(true);
  state("inactive");
  finish(granted);
  await request;
  expect(m.read).not.toHaveBeenCalled();
  expect(m.snapshot!().people).toEqual([]);
  m.getPermission.mockResolvedValue(granted);
  state("active");
  await settle();
  expect(m.snapshot!().people).toHaveLength(1);
  expect(m.requestPermission).toHaveBeenCalledOnce();
});
it("multiple screens share one listener and one paged read; unmounting the last screen clears memory", async () => {
  m.active = "active";
  m.read
    .mockResolvedValueOnce({ ...page, hasNextPage: true })
    .mockResolvedValueOnce({
      data: [
        {
          id: "2",
          name: "Second friend",
          phoneNumbers: [{ number: "+442079460018" }],
        },
      ],
      hasNextPage: false,
    });
  mount();
  mount();
  await settle();
  expect(m.callbacks.size).toBe(1);
  expect(m.read).toHaveBeenCalledTimes(2);
  expect(m.read.mock.calls[1][0]).toMatchObject({
    pageOffset: 1,
    pageSize: 500,
  });
  expect(m.snapshot!().people).toHaveLength(2);
  cleanups.pop()!();
  expect(m.callbacks.size).toBe(1);
  expect(m.snapshot!().people).toHaveLength(2);
  cleanups.pop()!();
  expect(m.snapshot!().people).toEqual([]);
});
