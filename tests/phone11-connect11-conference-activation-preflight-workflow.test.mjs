import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL(
  "../.github/workflows/phone11-connect11-conference-activation-preflight.yml",
  import.meta.url,
);

test("conference activation preflight is manual and read-only", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:\s*\n/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
  assert.match(workflow, /permissions:\s*\n\s+contents:\s+read\s*\n/);
  assert.doesNotMatch(
    workflow,
    /write-all|contents:\s+write|actions:\s+write/i,
  );
});

test("conference activation preflight requires both protected secrets without printing them", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(
    workflow,
    /PHONE11_PLAIN_VIDEO_ADMISSION_DATABASE_URL:\s+\$\{\{\s*secrets\.PHONE11_PLAIN_VIDEO_ADMISSION_DATABASE_URL\s*\}\}/,
  );
  assert.match(
    workflow,
    /PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS:\s+\$\{\{\s*secrets\.PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS\s*\}\}/,
  );
  assert.match(workflow, /required database secret is unavailable/);
  assert.match(workflow, /required Connect11 tenant secret is unavailable/);
  assert.doesNotMatch(
    workflow,
    /(?:echo|printf|cat|printenv|env)\b[^\n]*(?:PHONE11_PLAIN_VIDEO_ADMISSION_DATABASE_URL|PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS)/i,
  );
  assert.doesNotMatch(
    workflow,
    /secrets\.[A-Z0-9_]+\s*\}\}[^\n]*(?:echo|printf)/i,
  );
});

test("conference activation preflight has no remote access, deployment, migration, or provider-side actions", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.doesNotMatch(
    workflow,
    /\b(?:ssh|scp|rsync|aws|gcloud|kubectl|terraform|ansible)\b/i,
  );
  assert.doesNotMatch(
    workflow,
    /\b(?:deploy|restart|provision|docker\s+(?:compose\s+)?(?:up|restart|exec)|pnpm\s+(?:db:push|db:push)|drizzle-kit\s+(?:migrate|push)|CREATE\s+(?:TABLE|ROOM)|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b/i,
  );
  assert.match(workflow, /meetings:plain-video:preflight/);
  assert.match(workflow, /Prerequisites\|Migration state\|Outcome/);
  assert.match(workflow, /Readiness: activation remains manual and gated/);
});

test("readiness artifact contains status text only", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /phone11-connect11-conference-readiness\.txt/);
  assert.match(workflow, /Secret values and connection details are withheld/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /if-no-files-found: error/);
});
