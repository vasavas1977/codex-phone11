import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getPool } from "../pbx/db";
import { readChannelMeetingConfiguration } from "./channel-meeting-config";
import {
  adminOverviewSchema,
  adminSetHostPermissionSchema,
  createChannelMeetingAdminRepository,
  type ChannelMeetingAdminRepository,
} from "./channel-meeting-admin-repository";
import {
  createChannelMeetingRepository,
  type ChannelMeetingRepository,
} from "./channel-meeting-repository";
import {
  channelCapabilitiesSchema,
  channelInvitationsSchema,
  createChannelMeetingService,
  startChannelMeetingSchema,
} from "./channel-meeting-service";
import { createConnect11PlainVideoFacade } from "./connect11-plain-video-facade";
import { createDirectMeetingRepository, type DirectMeetingRepository } from "./direct-meeting-repository";
import { adminSetDirectHostPermissionSchema, createDirectMeetingService,
  directMeetingScopeSchema, startDirectMeetingSchema } from "./direct-meeting-service";
import { readServerConnect11PlainVideoTenantConfiguration } from "./connect11-plain-video-config";
import {
  createConnect11PlainVideoTenantProvider,
  type Connect11PlainVideoTenantExternalConfig,
} from "./connect11-plain-video-tenant-provider";
import type {
  Connect11PlainVideoAdmissionClient,
  Connect11PlainVideoAdmissionResolver,
} from "./connect11-plain-video-provider";
import { createPlainVideoAdmissionResolver } from "./plain-video-admission-resolver";
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
  create(
    config: Connect11PlainVideoTenantExternalConfig,
  ): Connect11PlainVideoAdmissionClient;
};

/** Test seams only; production defaults stay server-side and credential-free in source. */
export type MeetingsRouterDependencies = {
  transaction?: PlainVideoReadOnlyTransaction;
  issuanceTransaction?: PlainVideoIssuanceTransaction;
  repository?: MeetingRepository;
  resolver?: Connect11PlainVideoAdmissionResolver;
  clientFactory?: PlainVideoClientFactory;
  channelRepository?: ChannelMeetingRepository;
  channelAdminRepository?: ChannelMeetingAdminRepository;
  directRepository?: DirectMeetingRepository;
};

function defaultClientFactory(): PlainVideoClientFactory {
  return {
    create: (tenant) =>
      createConnect11PlainVideoFacade({
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
  if (!configuration.enabled)
    return {
      service: createMeetingService({ authorize: async () => null }),
      configuredTenantIds: [] as readonly number[],
    };

  try {
    let transaction = dependencies.transaction;
    const getTransaction = () =>
      (transaction ??= createPlainVideoPostgresReadOnlyTransaction(getPool()));
    let issuanceTransaction = dependencies.issuanceTransaction;
    const getIssuanceTransaction = () =>
      (issuanceTransaction ??=
        createPlainVideoPostgresIssuanceTransaction(getPool()));
    const repository =
      dependencies.repository ??
      createPlainVideoMeetingRepository(getTransaction());
    const resolver =
      dependencies.resolver ??
      createPlainVideoAdmissionResolver(
        getIssuanceTransaction(),
        createPlainVideoAdmissionLeaseRepository(getIssuanceTransaction()),
      );
    const provider = createConnect11PlainVideoTenantProvider(
      configuration,
      resolver,
      dependencies.clientFactory ?? defaultClientFactory(),
    );
    return {
      service: createMeetingService(repository, provider),
      configuredTenantIds: configuration.tenants.map(
        (tenant) => tenant.tenantId,
      ),
    };
  } catch {
    // A broken server composition must fail closed like missing configuration.
    return {
      service: createMeetingService({ authorize: async () => null }),
      configuredTenantIds: [] as readonly number[],
    };
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
  const configured = createConfiguredMeetingService(env, dependencies);
  const channelConfiguration = readChannelMeetingConfiguration(env);
  const channelService = createChannelMeetingService(
    dependencies.channelRepository ?? createChannelMeetingRepository(),
    channelConfiguration.enabled
      ? channelConfiguration.tenantIds.filter(id => configured.configuredTenantIds.includes(id))
      : [],
  );
  const directService = createDirectMeetingService(
    dependencies.directRepository ?? createDirectMeetingRepository(),
    channelConfiguration.enabled
      ? channelConfiguration.tenantIds.filter(id => configured.configuredTenantIds.includes(id))
      : [],
  );
  const channelAdminRepository = dependencies.channelAdminRepository ?? createChannelMeetingAdminRepository();
  const selectedTenantSchema = z.object({ tenantId: z.number().int().positive().refine(Number.isSafeInteger) }).strict();
  const exactMeetingSchema = selectedTenantSchema.extend({ meetingId: z.string().uuid() }).strict();
  const channelEnabled = (tenantId: number) => channelConfiguration.enabled
    && channelConfiguration.tenantIds.includes(tenantId)
    && configured.configuredTenantIds.includes(tenantId);
  return router({
    adminOverview: protectedProcedure
      .input(adminOverviewSchema)
      .query(({ ctx, input }) => channelAdminRepository.overview(ctx.user.id, input.tenantId, channelEnabled(input.tenantId), input.directCursor, input.channelCursor)),
    adminSetHostPermission: protectedProcedure
      .input(adminSetHostPermissionSchema)
      .mutation(({ ctx, input }) => channelAdminRepository.setHostPermission(ctx.user.id, input, channelEnabled(input.tenantId))),
    adminSetDirectHostPermission: protectedProcedure
      .input(adminSetDirectHostPermissionSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await channelAdminRepository.setHostPermission(ctx.user.id, {
          tenantId: input.tenantId, channelId: input.conversationId,
          userId: input.userId, canStartMeeting: input.canStartMeeting,
        }, channelEnabled(input.tenantId), "direct");
        return { conversationId: result.channelId, userId: result.userId,
          canStartMeeting: result.canStartMeeting };
      }),
    capabilities: protectedProcedure.query(({ ctx }) =>
      configured.service.capabilitiesFor(
        ctx.user.id,
        configured.configuredTenantIds,
      ),
    ),
    available: protectedProcedure.query(async ({ ctx }) =>
      (await configured.service.availableMeetingsFor(
        ctx.user.id,
        configured.configuredTenantIds,
      )).map(({ meetingId }) => ({ meetingId })),
    ),
    availableForTenant: protectedProcedure
      .input(selectedTenantSchema)
      .query(async ({ ctx, input }) =>
        (await configured.service.availableMeetingsFor(
          ctx.user.id,
          configured.configuredTenantIds.filter((tenantId) => tenantId === input.tenantId),
        )).map((meeting) => ({ ...meeting, tenantId: input.tenantId })),
      ),
    availableMeetingForTenant: protectedProcedure
      .input(exactMeetingSchema)
      .query(({ ctx, input }) => configured.service.availableMeetingForTenant(
        ctx.user.id, input.tenantId, input.meetingId, configured.configuredTenantIds)),
    join: protectedProcedure
      .input(joinMeetingSchema)
      .mutation(({ ctx, input }) =>
        configured.service.join(ctx.user.id, input),
      ),
    channelCapabilities: protectedProcedure
      .input(channelCapabilitiesSchema)
      .query(({ ctx, input }) => channelService.capabilities(ctx.user.id, input)),
    startChannelMeeting: protectedProcedure
      .input(startChannelMeetingSchema)
      .mutation(({ ctx, input }) => channelService.start(ctx.user.id, input)),
    invitations: protectedProcedure
      .input(channelInvitationsSchema)
      .query(({ ctx, input }) => channelService.invitations(ctx.user.id, input)),
    directCapabilities: protectedProcedure
      .input(directMeetingScopeSchema)
      .query(({ ctx, input }) => directService.capabilities(ctx.user.id, input)),
    startDirectMeeting: protectedProcedure
      .input(startDirectMeetingSchema)
      .mutation(({ ctx, input }) => directService.start(ctx.user.id, input)),
    directInvitations: protectedProcedure
      .input(directMeetingScopeSchema)
      .query(({ ctx, input }) => directService.invitations(ctx.user.id, input)),
  });
}

export const meetingsRouter = createMeetingsRouter();
