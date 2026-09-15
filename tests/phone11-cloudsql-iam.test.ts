import {describe,expect,it,vi} from "vitest";
import {buildPgConfig} from "../server/pbx/db";

const instance="phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg";
const source:NodeJS.ProcessEnv={
  PHONE11_CLOUDSQL_IAM_DB_AUTH:"1",
  PHONE11_CLOUDSQL_INSTANCE:instance,
  PG_HOST:`/cloudsql/${instance}`,
  PG_USER:"phone11-fcm-lab@phone11-stage-20260914.iam",
  PG_DATABASE:"phone11_wake_stage",
  PG_SSL:"disable",
};

describe("Phone11 isolated Cloud SQL IAM pool",()=>{
  it("uses a transient token callback on the connector socket",async()=>{
    const token=vi.fn(async()=>"short-lived-test-token");
    const config=buildPgConfig(source,token);
    expect(config).toMatchObject({host:`/cloudsql/${instance}`,user:source.PG_USER,database:"phone11_wake_stage",ssl:false});
    expect(config).not.toHaveProperty("connectionString");
    expect(typeof config.password).toBe("function");
    await expect((config.password as ()=>Promise<string>)()).resolves.toBe("short-lived-test-token");
    expect(token).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong socket",{PG_HOST:"/cloudsql/other:region:instance"}],
    ["password present",{PG_PASSWORD:"must-not-be-used"}],
    ["URL secret present",{DATABASE_URL:"postgresql://secret@example.invalid/db"}],
    ["non-IAM user",{PG_USER:"password-user"}],
  ])("rejects %s",(_name,change)=>{
    expect(()=>buildPgConfig({...source,...change},async()=>"unused")).toThrow("Cloud SQL IAM configuration is invalid");
  });

  it("keeps existing password database configuration compatible",()=>{
    const config=buildPgConfig({PG_HOST:"127.0.0.1",PG_USER:"local",PG_PASSWORD:"test-only",PG_DATABASE:"local",PG_SSL:"disable"});
    expect(config).toMatchObject({host:"127.0.0.1",user:"local",password:"test-only",database:"local",ssl:false});
  });
});
