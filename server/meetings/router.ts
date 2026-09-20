import { protectedProcedure, router } from "../_core/trpc";
import { getPool } from "../pbx/db";
import { createConnect11PlainVideoFacade } from "./connect11-plain-video-facade";
import { readServerConnect11PlainVideoTenantConfiguration } from "./connect11-plain-video-config";
import {
  createConnect11PlainVideoTenantProvider,
  type Connect11PlainVideoTenantExternalConfig,
} from "./connect11-plain-video-tenant-provider";
import type {
  Connect11PlainVideoAdmissionClient,
  Connect11PlainVideoAdmissionResolver,
} from "./connect11-plain-video-provider";
import {
  createPlainVideoAdmissionResolver,
} from "./plain-video-admission-resolver";
import {
  createPlainVideoAdmissionLeaseRepository,
  createPlainVideoPostgresIssuanceTransaction,
  type PlainVideoIssuanceTransaction,
} from "./plain-video-admission-lease-repository";
import {
  createPlainVideoMeetingRepository,
  createPlainVideoPostgresReadOnlyTransaction,
  type PlainVideoReadOnlyTransaction,
} from "./plain-video-admission-repository";
import {
  createMeetingService,
  joinMeetingSchema,
  type MeetingRepository,
} from "./service";

type PlainVideoClientFactory = {
  create(config: Connect11PlainVideoTenantExternalConfig): Connect11PlainVideoAdmissionClient;
};

/** Test seams only; production defaults stay server-side and credential-free in source. */
export type MeetingsRouterDependencies = {
  transaction?: PlainVideoReadOnlyTransaction;
  issuanceTransaction?: PlainVideoIssuanceTransaction;
  repository?: MeetingRepository;
  resolver?: Connect11PlainVideoAdmissionResolver;
  clientFactory?: PlainVideoClientFactory;
};

function defaultClientFactory(): PlainVideoClientFactory {
  return {
    create: (tenant) => createConnect11PlainVideoFacade({
      baseUrl: tenant.apiBaseUrl,
      statusCredential: tenant.statusCredential,
      joinCredential: tenant.joinCredential,
    }),
  };
}

function createConfiguredMeetingService(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: MeetingsRouterDependencies,
) {
  const configuration = readServerConnect11PlainVideoTenantConfiguration(env);
  if (!configuration.enabled) return createMeetingService({ authorize: async () => null });

  try {
    let transaction = dependencies.transaction;
    const getTransaction = () => transaction ??= createPlainVideoPostgresReadOnlyTransaction(getPool());
    let issuanceTransaction = dependencies.issuanceTransaction;
    const getIssuanceTransaction = () => issuanceTransaction ??=
      createPlainVideoPostgresIssuanceTransaction(getPool());
    const repository = dependencies.repository ?? createPlainVideoMeetingRepository(getTransaction());
    const resolver = dependencies.resolver ?? createPlainVideoAdmissionResolver(
      getIssuanceTransaction(),
      createPlainVideoAdmissionLeaseRepository(getIssuanceTransaction()),
    );
    const provider = createConnect11PlainVideoTenantProvider(
      configuration,
      resolver,
      dependencies.clientFactory ?? defaultClientFactory(),
    );
    return createMeetingService(repository, provider);
  } catch {
    // A broken server composition must fail closed like missing configuration.
    return createMeetingService({ authorize: async () => null });
  }
}

/**
 * Mounts only the plain-video path. The client can submit a meeting UUID, but
 * room identity, participant identity, tenant choice, and credentials remain
 * server-owned from the first authorization through the facade request.
 */
export function createMeetingsRouter(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: MeetingsRouterDependencies = {},
) {
  const service = createConfiguredMeetingService(env, dependencies);
  return router({
  capabilities: protectedProcedure.query(() => service.capabilities()),
  available: protectedProcedure.query(() => service.availableMeetingsFor()),
  join: protectedProcedure.input(joinMeetingSchema).mutation(({ ctx, input }) =>
    service.join(ctx.user.id, input)),
  });
}

export const meetingsRouter = createMeetingsRouter();
