import { Hono } from "hono";
import type { RefreshRequest, TokenExchangeRequest, TokenResponse } from "../../shared/auth";
import type { AppEnv, Env } from "../env";
import { exchangeCode, GoogleTokenError, refreshTokens, revokeToken, type GoogleTokenSet } from "../lib/google";
import { IdTokenError, verifyGoogleIdToken } from "../lib/idToken";
import { resolveUser } from "../lib/session";

/**
 * Google とのトークン交換・更新の中継。
 * トークンはサーバーに保存せず、検証と利用可否の判定だけ行って端末へ返す。
 */
export const auth = new Hono<AppEnv>();

auth.post("/token", async (c) => {
  const body = await c.req.json<TokenExchangeRequest>().catch(() => null);
  if (!body?.code || !body.codeVerifier || !body.redirectUri) return c.json({ error: "リクエストが不正です" }, 400);
  if (new URL(body.redirectUri).origin !== new URL(c.req.url).origin) {
    return c.json({ error: "リダイレクト先が不正です" }, 400);
  }

  let tokens: GoogleTokenSet;
  try {
    tokens = await exchangeCode(credentials(c.env), body.code, body.codeVerifier, body.redirectUri);
  } catch (e) {
    return c.json({ error: `Google でのログインに失敗しました: ${errorMessage(e)}` }, 400);
  }
  return respond(c.env, tokens, tokens.refresh_token, body.inviteToken);
});

auth.post("/refresh", async (c) => {
  const body = await c.req.json<RefreshRequest>().catch(() => null);
  if (!body?.refreshToken) return c.json({ error: "リクエストが不正です" }, 400);

  let tokens: GoogleTokenSet;
  try {
    tokens = await refreshTokens(credentials(c.env), body.refreshToken);
  } catch (e) {
    // invalid_grant は更新用トークンの失効（6か月未使用・アクセス取り消し等）。端末側で再ログインさせる
    const status = e instanceof GoogleTokenError && e.code === "invalid_grant" ? 401 : 502;
    return c.json({ error: errorMessage(e), code: e instanceof GoogleTokenError ? e.code : undefined }, status);
  }
  return respond(c.env, tokens, body.refreshToken, undefined);
});

/** ログアウト時に Google 側のトークンを失効させる */
auth.post("/revoke", async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => null);
  if (body?.token) await revokeToken(body.token);
  return c.json({ ok: true });
});

async function respond(
  env: Env,
  tokens: GoogleTokenSet,
  refreshTokenForRevoke: string | undefined,
  inviteToken: string | undefined,
): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  if (!tokens.id_token) return json({ error: "ID トークンが取得できませんでした" }, 502);
  let claims;
  try {
    claims = await verifyGoogleIdToken(tokens.id_token, env.GOOGLE_CLIENT_ID);
  } catch (e) {
    return json({ error: `ID トークンが不正です: ${errorMessage(e)}` }, 401);
  }

  const now = Date.now();
  const result = await resolveUser(env, claims, inviteToken, now);
  if (!result.ok) {
    // 利用できないアカウントにはトークンを渡さず、Google 側でも失効させる
    await revokeToken(refreshTokenForRevoke ?? tokens.access_token);
    const message =
      result.reason === "disabled"
        ? "このアカウントは利用停止されています"
        : "このアカウントは招待されていないか、招待の有効期限が切れています";
    return json({ error: message, code: result.reason }, 403);
  }

  const res: TokenResponse = {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Math.min(now + tokens.expires_in * 1000, claims.exp * 1000),
    user: result.user,
  };
  return json(res);
}

function credentials(env: Env) {
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

function errorMessage(e: unknown): string {
  if (e instanceof GoogleTokenError || e instanceof IdTokenError || e instanceof Error) return e.message;
  return String(e);
}
