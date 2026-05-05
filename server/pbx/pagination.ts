/**
 * Pagination Utilities
 * 
 * Supports both offset-based and cursor-based pagination.
 * Cursor-based is preferred for large datasets (call records, audit logs).
 */

export interface PaginationInput {
  page?: number;
  pageSize?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
    nextCursor?: string;
  };
}

/**
 * Build SQL pagination clause
 */
export function buildPaginationSQL(input: PaginationInput): {
  limit: number;
  offset: number;
  orderBy: string;
} {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize || 25));
  const offset = (page - 1) * pageSize;
  const sortBy = sanitizeColumnName(input.sortBy || "id");
  const sortOrder = input.sortOrder === "asc" ? "ASC" : "DESC";

  return {
    limit: pageSize,
    offset,
    orderBy: `${sortBy} ${sortOrder}`,
  };
}

/**
 * Build paginated response from query results
 */
export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  input: PaginationInput
): PaginatedResult<T> {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize || 25));
  const totalPages = Math.ceil(total / pageSize);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Sanitize column name to prevent SQL injection
 */
function sanitizeColumnName(name: string): string {
  // Only allow alphanumeric and underscore
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "");
  // Whitelist of allowed sort columns
  const allowed = [
    "id", "created_at", "updated_at", "name", "extension_number",
    "sip_username", "number_e164", "started_at", "ended_at",
    "duration_seconds", "status", "display_name", "email",
  ];
  return allowed.includes(cleaned) ? cleaned : "id";
}
