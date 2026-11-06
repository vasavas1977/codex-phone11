// These virtual module names resolve to maintained sources in build.mjs.
// Root type checking uses the same source signatures without loading modules.
declare module "phone11-maintained/db" {
  export const withTransaction: typeof import("../../server/pbx/db").withTransaction;
}

declare module "phone11-maintained/auth" {
  export const getPhone11Auth: typeof import("../../server/_core/phone11-auth").getPhone11Auth;
  export const readAuthConfig: typeof import("../../server/_core/phone11-auth").readAuthConfig;
}

declare module "phone11-maintained/wake-service" {
  export const createWakeService: typeof import("../../server/push/wake-service").createWakeService;
  export const wakePilots: typeof import("../../server/push/wake-service").wakePilots;
}

declare module "phone11-maintained/apns" {
  export const readApnsConfig: typeof import("../../server/push/apns").readApnsConfig;
}

declare module "phone11-maintained/integration-auth" {
  export const integrationSecretStatus: typeof import("../../server/pbx/integration-auth").integrationSecretStatus;
}

declare module "phone11-maintained/auth-routes" {
  export const phone11Cors: typeof import("../../server/_core/auth-routes").phone11Cors;
  export const registerAuthRoutes: typeof import("../../server/_core/auth-routes").registerAuthRoutes;
}

declare module "phone11-maintained/wake-routes" {
  export const registerWakeRoutes: typeof import("../../server/push/wake-routes").registerWakeRoutes;
}

declare module "phone11-maintained/chat-media" {
  export const createChatMediaRouter: typeof import("../../server/chat/media").createChatMediaRouter;
}

declare module "phone11-maintained/recording-storage" {
  export const storageRouter: typeof import("../../server/pbx/recording-storage").storageRouter;
}

declare module "phone11-maintained/runtime-role" {
  export const createPhone11RuntimeLifecycle: typeof import("../../server/_core/runtime-role").createPhone11RuntimeLifecycle;
  export const createPhone11Shutdown: typeof import("../../server/_core/runtime-role").createPhone11Shutdown;
}
