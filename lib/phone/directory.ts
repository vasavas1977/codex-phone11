export interface DirectoryContact {
  id: number;
  name: string;
  extension: string | null;
  /** Authenticated server-relative path; absent on older servers. */
  photoUrl?: string | null;
}
export interface DirectoryWorkspace {
  id: number;
  name: string;
}

/** A bare extension is only meaningful inside the currently provisioned phone tenant. */
export function canCallDirectoryContact(
  person: DirectoryContact,
  tenantId: number | undefined,
  account: { ownerUserId?: number; tenantId?: number; enabled: boolean } | null,
  ownerUserId: number | undefined,
): boolean {
  return Boolean(
    person.extension &&
    /^\d{1,20}$/.test(person.extension) &&
    tenantId &&
    ownerUserId &&
    account?.enabled &&
    account.ownerUserId === ownerUserId &&
    account.tenantId === tenantId,
  );
}

export function positiveRouteId(
  value: string | string[] | undefined,
): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

export function readDirectory(value: unknown): DirectoryContact[] {
  if (!Array.isArray(value)) throw new Error("Invalid directory response");
  const ids = new Set<number>();
  return value.map((person) => {
    if (
      !person ||
      !Number.isSafeInteger(person.id) ||
      person.id <= 0 ||
      typeof person.name !== "string" ||
      !person.name.trim() ||
      ids.has(person.id) ||
      !(person.extension === null || typeof person.extension === "string") ||
      !(person.photoUrl === undefined || person.photoUrl === null ||
        (typeof person.photoUrl === "string" && /^\/api\/profile\/photo\/[1-9]\d*\/[1-9]\d*\?v=[0-9a-f-]{36}$/i.test(person.photoUrl)))
    ) {
      throw new Error("Invalid directory response");
    }
    ids.add(person.id);
    return {
      id: person.id,
      name: person.name.trim(),
      extension: person.extension,
      ...(person.photoUrl !== undefined ? { photoUrl: person.photoUrl } : {}),
    };
  });
}

export function filterDirectory(
  people: DirectoryContact[],
  query: string,
): DirectoryContact[] {
  const text = query.normalize("NFKC").trim().toLocaleLowerCase();
  const digits = text.replace(/[\s().-]/g, "");
  return people
    .filter(
      (person) =>
        !text ||
        person.name.normalize("NFKC").toLocaleLowerCase().includes(text) ||
        (digits !== "" && (person.extension ?? "").includes(digits)),
    )
    .sort((a, b) =>
      a.name.localeCompare(b.name, ["th", "en"], { sensitivity: "base" }),
    );
}
