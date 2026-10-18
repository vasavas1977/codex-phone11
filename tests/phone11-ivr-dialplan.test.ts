import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
const cache = vi.hoisted(() => ({ values: new Map<string, string>(), cacheGetOrSet: vi.fn() }));

vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: cache.cacheGetOrSet }));

import { generateIvrDialplan } from "../server/pbx/dialplan-generators";

const menu = (overrides: Record<string, unknown> = {}) => ({
  id: 41, name: "Support", greeting_tts: "Welcome to Phone11", timeout_ms: 5000,
  max_retries: 3, digit_timeout_ms: 3000, ...overrides,
});
const escaped = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockReset();
  cache.values.clear();
  cache.cacheGetOrSet.mockImplementation(async (key: string, _ttl: number, generate: () => Promise<string>) => {
    if (cache.values.has(key)) return cache.values.get(key)!;
    const value = await generate(); cache.values.set(key, value); return value;
  });
});

describe("IVR dialplan XML and cache isolation", () => {
  it("does not reuse a cached menu for a different tenant", async () => {
    db.query.mockResolvedValueOnce({ rows: [menu()] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const owned = await generateIvrDialplan(41, 7);
    expect(owned).toContain('data="tenant_id=7"');
    expect(await generateIvrDialplan(41, 7)).toBe(owned);
    const denied = await generateIvrDialplan(41, 8);
    expect(denied).toContain('extension name="not-found"');
    expect(denied).not.toContain('data="tenant_id=7"');
    expect(db.query.mock.calls[2][1]).toEqual([41, 8]);
    expect(cache.cacheGetOrSet).toHaveBeenCalledWith("dialplan:ivr:7:41", 300, expect.any(Function));
    expect(cache.cacheGetOrSet).toHaveBeenCalledWith("dialplan:ivr:8:41", 300, expect.any(Function));
  });

  it("does not reuse legacy unscoped XML from before escaping was introduced", async () => {
    cache.values.set("dialplan:ivr:41", "legacy unscoped XML");
    db.query.mockResolvedValueOnce({ rows: [menu()] }).mockResolvedValueOnce({ rows: [] });
    const xml = await generateIvrDialplan(41, 7);
    expect(xml).toContain('data="tenant_id=7"');
    expect(xml).not.toBe("legacy unscoped XML");
  });

  it.each(["greeting_file", "greeting_tts", "invalid_sound", "name"])(
    "keeps %s text inside its XML attribute, including quotes and entity syntax", async field => {
      const text = `Sales & Support 'ไทย' "><action application="system" data="injected"/><!-- &quot;`;
      db.query.mockResolvedValueOnce({ rows: [menu({ [field]: text })] }).mockResolvedValueOnce({ rows: [] });
      const xml = await generateIvrDialplan(41, 7);
      expect(xml).toContain(escaped(text));
      expect(xml).not.toContain('<action application="system"');
      expect(xml.match(/<action\b/g)).toHaveLength(4);
    },
  );

  it("escapes legacy digit and target attributes without injecting entries or actions", async () => {
    const text = `1\"><entry action="menu-exec-app" digits="9" param="system injected"/><!--`;
    db.query.mockResolvedValueOnce({ rows: [menu()] }).mockResolvedValueOnce({ rows: [
      { digit: text, action_type: "transfer_ext", target: text },
    ] });
    const xml = await generateIvrDialplan(41, 7);
    expect(xml.match(/<entry\b/g)).toHaveLength(1);
    expect(xml).toContain(`digits="${escaped(text)}"`);
    expect(xml).toContain(`param="${escaped(`transfer ${text} XML default`)}"`);
    expect(xml).not.toContain('param="system injected"');
  });

  it("preserves intended FreeSWITCH expressions and valid DTMF actions", async () => {
    db.query.mockResolvedValueOnce({ rows: [menu({ greeting_file: "${sounds_dir}/ivr/welcome.wav" })] })
      .mockResolvedValueOnce({ rows: [{ digit: "*#", action_type: "transfer_ext", target: "3001" }] });
    const xml = await generateIvrDialplan(41, 7);
    expect(xml).toContain('greet-long="${sounds_dir}/ivr/welcome.wav"');
    expect(xml).toContain('digits="*#" param="transfer 3001 XML default"');
  });
});


describe("IVR collection and retry exit behavior", () => {
  it("emits a collection length covering accepted five-digit actions", async () => {
    db.query.mockResolvedValueOnce({ rows: [menu()] }).mockResolvedValueOnce({ rows: [
      { digit: "12345", action_type: "transfer_ext", target: "3001" },
      { digit: "1", action_type: "hangup" },
    ] });
    const xml = await generateIvrDialplan(41, 7);
    expect(xml).toContain('digit-len="5"');
    expect(xml).toContain('digits="12345" param="transfer 3001 XML default"');
  });

  it.each([
    ["hangup", undefined, "hangup NORMAL_CLEARING"],
    ["transfer", "3001", "transfer 3001 XML default"],
    ["voicemail", "3001", "transfer *983001 XML default"],
  ])("uses the %s exit for exhausted invalid-input and no-input retries", async (exit_action, exit_target, invocation) => {
    db.query.mockResolvedValueOnce({ rows: [menu({ exit_action, exit_target, max_retries: 7 })] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{}] });
    const xml = await generateIvrDialplan(41, 7);
    expect(xml).toContain(`exec-on-max-failures="${invocation}"`);
    expect(xml).toContain(`exec-on-max-timeouts="${invocation}"`);
    expect(xml).toContain('max-timeouts="7"');
    if (exit_action !== "hangup") {
      expect(db.query.mock.calls[2][0]).toMatch(/FROM extensions/);
      expect(db.query.mock.calls[2][1]).toEqual([7, "3001"]);
    }
  });

  it.each(["transfer", "voicemail"])("fails closed when the legacy %s exit extension is inactive or foreign", async exit_action => {
    db.query.mockResolvedValueOnce({ rows: [menu({ exit_action, exit_target: "3001" })] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const xml = await generateIvrDialplan(41, 7);
    expect(xml).toContain('exec-on-max-failures="hangup NORMAL_CLEARING"');
    expect(xml).not.toContain('transfer 3001');
    expect(xml).not.toContain('transfer *983001');
    expect(db.query.mock.calls[2][0]).toMatch(/status = 'active' AND deleted_at IS NULL/);
  });

  it.each([undefined, "", "3001 XML foreign", "${destination_number}"])("fails closed for an unsafe legacy exit target %s", async exit_target => {
    db.query.mockResolvedValueOnce({ rows: [menu({ exit_action: "transfer", exit_target })] })
      .mockResolvedValueOnce({ rows: [] });
    const xml = await generateIvrDialplan(41, 7);
    expect(xml).toContain('exec-on-max-failures="hangup NORMAL_CLEARING"');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

describe("IVR XML 1.0 character validity", () => {
  it.each(["\u0000", "\u0001", "\u000b", "\u001f", "\ufffe", "\uffff", "\ud800", "\udfff"])(
    "returns the safe not-found XML for a prohibited XML character %j", async invalid => {
      db.query.mockResolvedValueOnce({ rows: [menu({ greeting_tts: `Welcome${invalid}caller` })] })
        .mockResolvedValueOnce({ rows: [] });
      const xml = await generateIvrDialplan(41, 7);
      expect(xml).toContain('extension name="not-found"');
      expect(xml).not.toContain(invalid);
      expect(xml).not.toContain('application="ivr"');
    },
  );
  it.each(["name", "greeting_file", "invalid_sound", "timeout_ms", "max_retries", "digit_timeout_ms"])(
    "fails closed for prohibited characters in stored %s", async field => {
      db.query.mockResolvedValueOnce({ rows: [menu({ [field]: "bad\u0000value" })] })
        .mockResolvedValueOnce({ rows: [] });
      expect(await generateIvrDialplan(41, 7)).toContain('extension name="not-found"');
    },
  );
  it.each(["digit", "target"])("fails closed for prohibited characters in a stored action %s", async field => {
    db.query.mockResolvedValueOnce({ rows: [menu()] }).mockResolvedValueOnce({ rows: [
      { digit: "1", action_type: "transfer_ext", target: "3001", [field]: "bad\u0000value" },
    ] });
    expect(await generateIvrDialplan(41, 7)).toContain('extension name="not-found"');
  });
  it("preserves valid XML characters, Thai, astral symbols, and FreeSWITCH macros", async () => {
    const greeting = "${sounds_dir}/ไทย😀\t\r\n.wav";
    db.query.mockResolvedValueOnce({ rows: [menu({ greeting_file: greeting })] }).mockResolvedValueOnce({ rows: [] });
    expect(await generateIvrDialplan(41, 7)).toContain(`greet-long="${greeting}"`);
  });
});
