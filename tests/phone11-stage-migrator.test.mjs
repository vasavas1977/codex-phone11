import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const entrypoint=readFileSync("infra/cloud-run/phone11-stage-migrator/entrypoint.sh","utf8");
const deploy=readFileSync("infra/cloud-run/phone11-stage-migrator/deploy.sh","utf8");
const docker=readFileSync("infra/cloud-run/phone11-stage-migrator/Dockerfile","utf8");

test("migrator is keyless, exact-target and dry-run by default",()=>{
  for(const value of ["phone11-stage-20260914","phone11_wake_stage","sip.stage.phone11.test","7101","phone11-stage-migrator@phone11-stage-20260914.iam.gserviceaccount.com"])
    assert.ok((entrypoint+deploy).includes(value));
  assert.match(entrypoint,/DATABASE_URL.*PG_CONNECTION_STRING.*PG_PASSWORD/);
  assert.match(deploy,/validated; no job deployed or executed/);
  assert.ok(deploy.indexOf("no job deployed")<deploy.indexOf("gcloud run jobs deploy"));
  assert.match(deploy,/--set-cloudsql-instances="\$EXPECTED_INSTANCE"/);
  assert.match(deploy,/--max-retries=0 --tasks=1 --parallelism=1/);
  assert.doesNotMatch(deploy,/--set-env-vars=.*PASSWORD|service-account-key|credentials\.json/);
});

test("credential identity remains a separate file-backed auth-admin phase",()=>{
  assert.match(entrypoint,/identity-apply/);
  assert.match(entrypoint,/umask 077/);
  assert.match(entrypoint,/--password-file "\$PRIVATE_PASSWORD_FILE"/);
  assert.match(entrypoint,/trap cleanup/);
  assert.match(entrypoint,/auth-plan\|auth-apply\|identity-apply/);
  assert.match(entrypoint,/push-plan\|push-apply/);
  assert.match(entrypoint,/grants-plan\|grants-apply/);
  assert.match(docker,/dist\/auth-admin\.mjs/);
  assert.match(docker,/dist\/push-migrate\.mjs/);
  assert.match(docker,/dist\/runtime-grants\.mjs/);
});
