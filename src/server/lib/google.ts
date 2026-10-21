const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface GoogleTokenSet {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
  scope: string;
}

export class GoogleTokenError extends Error {
  constructor(
    message: string,
    /** invalid_grant など。更新用トークンが失効している場合は再ログインが必要 */
    readonly code: string | undefined,
  ) {
    super(message);
  }
}

interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

export function exchangeCode(
  cred: ClientCredentials,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<GoogleTokenSet> {
  return postToken({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
  });
}

export function refreshTokens(cred: ClientCredentials, refreshToken: string): Promise<GoogleTokenSet> {
  return postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
  });
}

/** トークンを失効させる（更新用トークンを渡すと紐づくアクセストークンも失効する）。失敗は無視する */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // 失効できなくても利用者側の操作は続行する
  }
}

async function postToken(params: Record<string, string>): Promise<GoogleTokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<GoogleTokenSet> & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new GoogleTokenError(body.error_description ?? body.error ?? `HTTP ${res.status}`, body.error);
  }
  return body as GoogleTokenSet;
}
