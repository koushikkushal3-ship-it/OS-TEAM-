export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Calls the TEAM OS backend through the same-origin `/api` proxy. */
export async function api<T = unknown>(
  path: string,
  options: { method?: Method; body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const qs = options.query
    ? "?" +
      new URLSearchParams(
        Object.entries(options.query)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)]),
      )
    : "";

  const res = await fetch(`/api${path}${qs}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join(", ") : (data?.message ?? res.statusText);
    const issues = data?.issues as ApiError["issues"];
    throw new ApiError(res.status, issues?.length ? issues.map((i) => i.message).join(" · ") : message, data?.code, issues);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
