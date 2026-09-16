import { describe, expect, it } from "vitest";
import {
  beginDirectoryRefresh,
  failDirectoryRefresh,
} from "../lib/phone/directory-sync";
import type { DirectoryState } from "../lib/phone/directory-sync";

const authorized: DirectoryState = {
  owner: 10,
  requestedTenant: 4,
  workspace: { id: 4, name: "Phone11" },
  workspaces: [{ id: 4, name: "Phone11" }],
  people: [{ id: 22, name: "Ari", extension: "3022" }],
  loading: false,
  error: null,
};

describe("tenant directory refresh", () => {
  it("keeps an authorized directory visible during a same-workspace refresh failure", () => {
    const refreshing = beginDirectoryRefresh(authorized, 10, 4);
    expect(refreshing.people).toEqual(authorized.people);
    expect(refreshing.loading).toBe(true);

    const failed = failDirectoryRefresh(refreshing, 10, 4);
    expect(failed.people).toEqual(authorized.people);
    expect(failed.workspace).toEqual(authorized.workspace);
    expect(failed.loading).toBe(false);
    expect(failed.error).toMatch(/connection/i);
  });

  it("does not carry contacts into another account or workspace", () => {
    expect(beginDirectoryRefresh(authorized, 11, 4).people).toEqual([]);
    expect(beginDirectoryRefresh(authorized, 10, 5).workspace).toBeNull();
    expect(failDirectoryRefresh(authorized, 11, 4).people).toEqual([]);
  });
});
