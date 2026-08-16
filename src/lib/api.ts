export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Stable machine-readable reason, when the endpoint sends one. The
     *  `message` is an English fallback; `code` is what the UI translates. */
    public code?: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || res.statusText, body.code);
  }
  return res.json();
}
