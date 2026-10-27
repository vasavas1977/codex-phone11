/** A transport failure or permission denial must never be treated as sign-out. */
export function isAdminSessionUnauthorized(error: unknown): boolean {
  try {
    if (typeof error !== "object" || error === null) return false;
    const data = (error as { data?: unknown }).data;
    if (typeof data !== "object" || data === null) return false;
    const { code, httpStatus } = data as {
      code?: unknown;
      httpStatus?: unknown;
    };
    // Read the tRPC application code, never an error message or a bare proxy 401.
    return (
      code === "UNAUTHORIZED" &&
      (httpStatus === undefined || httpStatus === 401)
    );
  } catch {
    return false;
  }
}
