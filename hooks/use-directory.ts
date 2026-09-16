import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./use-auth";
import * as Auth from "@/lib/_core/auth";
import { createTRPCClient } from "@/lib/trpc";
import {
  readDirectory,
} from "@/lib/phone/directory";
import {
  beginDirectoryRefresh,
  clearDirectory,
  emptyDirectoryState as empty,
  failDirectoryRefresh,
  type DirectoryState,
} from "@/lib/phone/directory-sync";

export type { DirectoryState } from "@/lib/phone/directory-sync";

let client: ReturnType<typeof createTRPCClient> | null = null;
const api = () => (client ??= createTRPCClient()).chat;
/** No persistent/shared directory cache: an old owner's response cannot reach the next account. */
export function useDirectory(tenantId?: number, enabled = true) {
  const { user } = useAuth({ autoFetch: false });
  const owner = user?.id ?? null;
  const [state, setState] = useState<DirectoryState>(empty);
  const stateRef = useRef<DirectoryState>(empty);
  const generation = useRef(0);
  const replaceState = useCallback((next: DirectoryState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const reload = useCallback(async () => {
    const revision = ++generation.current;
    // Do not enumerate an enterprise directory while the user is viewing only
    // private device contacts. Disabling also discards any prior in-memory
    // directory snapshot instead of leaving coworker data on an unrelated tab.
    if (!enabled || !owner) {
      replaceState(clearDirectory());
      return;
    }
    replaceState(beginDirectoryRefresh(stateRef.current, owner, tenantId));
    const current = () =>
      revision === generation.current &&
      Auth.getAuthSnapshot().user?.id === owner;
    try {
      const result = await api().list.query(
        tenantId ? { tenantId } : undefined,
      );
      if (!current()) return;
      const people = readDirectory(
        await api().directory.query({ tenantId: result.workspace.id }),
      );
      if (!current()) return;
      replaceState({
        owner,
        requestedTenant: tenantId,
        workspace: result.workspace,
        workspaces: result.workspaces,
        people,
        loading: false,
        error: null,
      });
    } catch {
      if (current())
        replaceState(failDirectoryRefresh(stateRef.current, owner, tenantId));
    }
  }, [enabled, owner, replaceState, tenantId]);
  useEffect(() => {
    void reload();
    return () => {
      generation.current++;
    };
  }, [reload]);
  const visible =
    enabled && state.owner === owner && state.requestedTenant === tenantId
      ? state
      : { ...empty, loading: Boolean(enabled && owner) };
  return { ...visible, signedIn: Boolean(enabled && owner), reload };
}

export async function openDirectConversation(
  tenantId: number,
  userId: number,
): Promise<string> {
  const owner = Auth.getAuthSnapshot().user?.id;
  if (!owner) throw new Error("Please sign in first.");
  const result = await api().create.mutate({
    tenantId,
    kind: "direct",
    name: "Direct message",
    memberIds: [userId],
  });
  if (Auth.getAuthSnapshot().user?.id !== owner)
    throw new Error("Your account changed. Please try again.");
  return result.id;
}
