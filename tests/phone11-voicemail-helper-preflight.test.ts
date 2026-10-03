import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectVoicemailHelperInputs,
  reviewedHelpers,
  runVoicemailHelperPreflight,
  type PreflightInputs,
} from "../scripts/phone11-voicemail-helper-preflight";

const now = Date.parse("2026-10-04T04:00:00Z");
const xml = Buffer.from(
  '<configuration name="modules.conf"><modules><load module="mod_lua"/></modules></configuration>',
);
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function fixture(): PreflightInputs {
  const reviewed = {} as PreflightInputs["reviewed"];
  const supplied = {} as PreflightInputs["supplied"];
  for (const name of Object.keys(
    reviewedHelpers,
  ) as (keyof typeof reviewedHelpers)[]) {
    const deploy = { bytes: readFileSync(`deploy/freeswitch/scripts/${name}`) };
    const infra = {
      bytes: readFileSync(`infra/configs/freeswitch/scripts/${name}`),
    };
    reviewed[name] = [deploy, infra];
    supplied[name] = deploy;
  }
  return {
    kind: "target",
    reviewed,
    supplied,
    modulesConfig: { bytes: xml },
    now,
    evidence: {
      version: 1,
      scope: "target",
      targetIdSha256: "a".repeat(64),
      observedAt: "2026-10-04T04:00:00+00:00",
      modulesConfigSha256: hash(xml),
      backendHookReady: false,
      freeswitchHookReady: false,
      moduleProbeExit: 0,
      luaModuleExists: true,
      helpers: Object.entries(reviewedHelpers).map(([name, sha256]) => ({
        name,
        sha256,
        readable: true,
      })),
    },
  };
}
const evidence = (input: PreflightInputs) =>
  input.evidence as Record<string, unknown>;
const result = (mutate: (input: PreflightInputs) => void) => {
  const input = fixture();
  mutate(input);
  return inspectVoicemailHelperInputs(input);
};

describe("file-only voicemail helper/runtime preflight", () => {
  it("accepts the exact reviewed pairs and fresh bound flag-off runtime evidence", () => {
    const report = inspectVoicemailHelperInputs(fixture());
    expect(report).toMatchObject({
      overall: "compatible",
      helperRuntimeReady: true,
      flagOffRehearsalReady: true,
      mode: "legacy",
      commissioningApproved: false,
      rolloutApproved: false,
      issues: [],
    });
  });
  it.each(Object.keys(reviewedHelpers) as (keyof typeof reviewedHelpers)[])(
    "refuses missing %s snapshot without asserting live absence",
    (name) => {
      expect(
        result((input) => {
          input.supplied[name] = { error: "missing" };
        }),
      ).toMatchObject({
        overall: "incompatible",
        helperRuntimeReady: false,
        issues: expect.arrayContaining([`${name}:snapshot_missing`]),
      });
    },
  );
  it("refuses an old installed helper digest", () => {
    expect(
      result((input) => {
        input.supplied["phone11_voicemail_deposit.lua"] = {
          bytes: Buffer.from("older helper"),
        };
      }),
    ).toMatchObject({ overall: "incompatible", helperRuntimeReady: false });
  });
  it("refuses source pair drift even when all supplied/attested bytes agree", () => {
    expect(
      result((input) => {
        input.reviewed["phone11_legacy_voicemail.lua"][1] = {
          bytes: Buffer.from("altered source"),
        };
      }),
    ).toMatchObject({ overall: "incompatible", helperRuntimeReady: false });
  });
  it("keeps unreadable snapshots unknown", () => {
    const report = result((input) => {
      input.supplied["phone11_legacy_voicemail.lua"] = { error: "unreadable" };
      (evidence(input).helpers as Record<string, unknown>[])[0].sha256 = null;
    });
    expect(report.overall).toBe("unknown");
    expect(report.helperRuntimeReady).toBe(false);
  });
  it.each([255, 1, null])(
    "failed/null Lua probe %s makes its false boolean UNKNOWN",
    (exit) => {
      const report = result((input) => {
        Object.assign(evidence(input), {
          moduleProbeExit: exit,
          luaModuleExists: false,
        });
      });
      expect(report).toMatchObject({
        overall: "unknown",
        runtime: { lua: "unknown" },
        helperRuntimeReady: false,
      });
      expect(report.issues).not.toContain("lua_runtime_missing");
    },
  );
  it("a successful explicit false probe establishes module missing", () => {
    expect(
      result((input) => {
        evidence(input).luaModuleExists = false;
      }),
    ).toMatchObject({
      overall: "incompatible",
      runtime: { lua: "incompatible" },
      issues: ["lua_runtime_missing"],
    });
  });
  it.each([
    null,
    { module_probe_exit: 255, lua_module_exists: false },
    { credentials: "private-secret" },
  ])("rejects malformed/unconverted evidence without private output", (bad) => {
    const report = result((input) => {
      input.evidence = bad;
    });
    expect(report.overall).toBe("unknown");
    expect(JSON.stringify(report)).not.toContain("private-secret");
  });
  it("rejects duplicate helper evidence and unknown fields", () => {
    expect(
      result((input) => {
        const helpers = evidence(input).helpers as unknown[];
        helpers[1] = helpers[0];
      }).overall,
    ).toBe("unknown");
    expect(
      result((input) => {
        evidence(input).rawOutput = "private-secret";
      }).overall,
    ).toBe("unknown");
  });
  it.each(["2026-10-04T03:44:59Z", "2026-10-04T04:01:01Z"])(
    "fails closed on stale/future evidence %s",
    (observedAt) => {
      expect(
        result((input) => {
          evidence(input).observedAt = observedAt;
        }),
      ).toMatchObject({
        overall: "unknown",
        helperRuntimeReady: false,
        issues: expect.arrayContaining(["evidence_stale_or_future"]),
      });
    },
  );
  it("accepts the deployed offset ISO timestamp format with six fractional digits", () => {
    expect(
      result((input) => {
        evidence(input).observedAt = "2026-10-04T11:00:00.000000+07:00";
      }).overall,
    ).toBe("compatible");
  });
  it("a stale successful false probe cannot assert a currently missing module", () => {
    const report = result((input) => {
      evidence(input).observedAt = "2026-10-04T03:00:00Z";
      evidence(input).luaModuleExists = false;
    });
    expect(report).toMatchObject({
      overall: "unknown",
      runtime: { lua: "unknown" },
    });
    expect(report.issues).not.toContain("lua_runtime_missing");
  });
  it("binds runtime helper and configuration digests", () => {
    expect(
      result((input) => {
        (evidence(input).helpers as Record<string, unknown>[])[0].sha256 =
          "b".repeat(64);
      }).overall,
    ).toBe("incompatible");
    expect(
      result((input) => {
        evidence(input).modulesConfigSha256 = "b".repeat(64);
      }).overall,
    ).toBe("incompatible");
  });
  it("requires positive runtime helper read access", () => {
    expect(
      result((input) => {
        (evidence(input).helpers as Record<string, unknown>[])[0].readable =
          false;
      }).overall,
    ).toBe("incompatible");
    expect(
      result((input) => {
        (evidence(input).helpers as Record<string, unknown>[])[0].readable =
          null;
      }).overall,
    ).toBe("unknown");
  });
  it.each([
    [true, false],
    [false, true],
  ])(
    "refuses backend/FreeSWITCH mismatch %s/%s",
    (backendHookReady, freeswitchHookReady) => {
      expect(
        result((input) => {
          Object.assign(evidence(input), {
            backendHookReady,
            freeswitchHookReady,
          });
        }),
      ).toMatchObject({
        overall: "incompatible",
        mode: "mismatch",
        helperRuntimeReady: false,
      });
    },
  );
  it("unknown process flags cannot establish compatibility", () => {
    expect(
      result((input) => {
        evidence(input).backendHookReady = null;
      }),
    ).toMatchObject({
      overall: "unknown",
      mode: "unknown",
      helperRuntimeReady: false,
    });
  });
  it.each(["missing", "unreadable"] as const)(
    "an unavailable %s config snapshot is UNKNOWN, not a claimed config mismatch",
    (error) => {
      const report = result((input) => {
        input.modulesConfig = { error };
      });
      expect(report.overall).toBe("unknown");
      expect(report.helperRuntimeReady).toBe(false);
      expect(report.issues).not.toContain("evidence_configuration_mismatch");
    },
  );
  it("both on is compatible protected mode but never flag-off or commissioning approval", () => {
    expect(
      result((input) => {
        Object.assign(evidence(input), {
          backendHookReady: true,
          freeswitchHookReady: true,
        });
      }),
    ).toMatchObject({
      overall: "compatible",
      mode: "protected",
      flagOffRehearsalReady: false,
      commissioningApproved: false,
      rolloutApproved: false,
    });
  });
  it("staging evidence cannot assert observed target readiness", () => {
    expect(
      result((input) => {
        input.kind = "staging";
        evidence(input).scope = "staging";
      }),
    ).toMatchObject({
      overall: "compatible",
      helperRuntimeReady: false,
      flagOffRehearsalReady: false,
    });
    expect(
      result((input) => {
        input.kind = "staging";
      }).overall,
    ).toBe("incompatible");
  });
  it.each([
    '<configuration name="modules.conf"><modules><!-- <load module="mod_lua"/> --></modules></configuration>',
    '<configuration name="other"><modules><load module="mod_lua"/></modules></configuration>',
    '<configuration name="modules.conf"><load module="mod_lua"/></configuration>',
  ])("requires active Lua load in the modules configuration", (config) => {
    expect(
      result((input) => {
        const bytes = Buffer.from(config);
        input.modulesConfig = { bytes };
        evidence(input).modulesConfigSha256 = hash(bytes);
      }).overall,
    ).toBe("incompatible");
  });
  it.each([
    "<broken",
    '<configuration name="modules.conf"><modules><X-PRE-PROCESS cmd="include" data="private-secret"/><load module="mod_lua"/></modules></configuration>',
    '<!DOCTYPE configuration><configuration name="modules.conf"><modules><load module="mod_lua"/></modules></configuration>',
    '<configuration name="modules.conf" xmlns="unknown"><modules><load module="mod_lua"/></modules></configuration>',
    '<configuration name="modules.conf"><modules condition="unknown"><load module="mod_lua"/></modules></configuration>',
  ])(
    "unresolved/malformed configuration is unknown with no content disclosure",
    (config) => {
      const report = result((input) => {
        const bytes = Buffer.from(config);
        input.modulesConfig = { bytes };
        evidence(input).modulesConfigSha256 = hash(bytes);
      });
      expect(report.overall).toBe("unknown");
      expect(JSON.stringify(report)).not.toContain("private-secret");
    },
  );
  it("CLI reads only supplied files, retains bytes, and returns safe invalid JSON evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "phone11-helper-preflight-"));
    try {
      for (const name of Object.keys(reviewedHelpers))
        writeFileSync(
          join(directory, name),
          readFileSync(`deploy/freeswitch/scripts/${name}`),
        );
      writeFileSync(join(directory, "modules.conf.xml"), xml);
      writeFileSync(
        join(directory, "evidence.json"),
        "private-secret invalid JSON",
      );
      const report = await runVoicemailHelperPreflight([
        "--kind",
        "target",
        "--helpers-dir",
        directory,
        "--modules-config",
        join(directory, "modules.conf.xml"),
        "--evidence",
        join(directory, "evidence.json"),
      ]);
      expect(report.overall).toBe("unknown");
      expect(readFileSync(join(directory, "evidence.json"), "utf8")).toBe(
        "private-secret invalid JSON",
      );
      expect(JSON.stringify(report)).not.toContain(directory);
      await expect(
        runVoicemailHelperPreflight(["--kind", "target", "--kind", "target"]),
      ).rejects.toThrow("invalid_arguments");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
