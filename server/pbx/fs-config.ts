export interface FreeSwitchConfig {
  host: string;
  port: number;
  password: string;
}

export function getFreeSwitchConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FreeSwitchConfig {
  const production = env.NODE_ENV === "production";
  const host = env.FREESWITCH_ESL_HOST || env.FS_ESL_HOST;
  const password = env.FREESWITCH_ESL_PASSWORD || env.FS_ESL_PASSWORD;
  const portText = env.FREESWITCH_ESL_PORT || env.FS_ESL_PORT || "8021";
  const port = Number(portText);

  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("FreeSWITCH ESL port must be an integer between 1 and 65535");
  }
  if (production && (!host || !password || password === "ClueCon")) {
    throw new Error("Production FreeSWITCH ESL requires an explicit host and non-default password");
  }

  return {
    host: host || "127.0.0.1",
    port,
    password: password || "ClueCon",
  };
}
