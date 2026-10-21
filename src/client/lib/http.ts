export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** JSON API を呼び、エラー時はサーバーのメッセージ付きで HttpError を投げる */
export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new HttpError(res.status, body.error ?? `HTTP ${res.status}`, body.code);
  return body as T;
}
