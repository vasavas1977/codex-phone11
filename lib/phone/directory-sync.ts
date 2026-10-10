import type { DirectoryContact, DirectoryWorkspace } from "./directory";

export interface DirectoryState {
  owner: number | null;
  requestedTenant?: number;
  workspace: DirectoryWorkspace | null;
  workspaces: DirectoryWorkspace[];
  people: DirectoryContact[];
  loading: boolean;
  error: string | null;
}

export const emptyDirectoryState: DirectoryState = {
  owner: null,
  workspace: null,
  workspaces: [],
  people: [],
  loading: false,
  error: null,
};

/** Discard a directory when its explicit Team source is no longer selected. */
export function clearDirectory(): DirectoryState {
  return { ...emptyDirectoryState };
}

/**
 * Keep an already-authorized workspace directory on screen while it refreshes.
 * A contact list belongs to exactly one account/workspace scope, so switching
 * either one deliberately starts from an empty snapshot.
 */
export function beginDirectoryRefresh(
  previous: DirectoryState,
  owner: number,
  tenantId?: number,
): DirectoryState {
  const sameScope =
    previous.owner === owner && previous.requestedTenant === tenantId;
  return {
    ...(sameScope ? previous : emptyDirectoryState),
    owner,
    requestedTenant: tenantId,
    loading: true,
    error: null,
  };
}

/** A network error must not erase an already-authorized directory snapshot. */
export function failDirectoryRefresh(
  previous: DirectoryState,
  owner: number,
  tenantId?: number,
): DirectoryState {
  const sameScope =
    previous.owner === owner && previous.requestedTenant === tenantId;
  return {
    ...(sameScope ? previous : emptyDirectoryState),
    owner,
    requestedTenant: tenantId,
    loading: false,
    error: "Could not load your contacts. Check your connection and try again.",
  };
}
