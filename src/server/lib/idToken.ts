import { base64UrlDecode } from "./crypto";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const CLOCK_SKEW_SEC = 60;

export interface GoogleIdClaims {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
}

export class IdTokenError extends Error {}

type Jwk = JsonWebKey & { kid: string };
export type JwksFetcher = () => Promise<Jwk[]>;

/** Google の ID トークン（RS256 の JWT）の署名とクレームを検証する */
export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  fetchJwks: JwksFetcher = fetchGoogleJwks,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<GoogleIdClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new IdTokenError("形式が不正です");
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string };
  let claims: GoogleIdClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    throw new IdTokenError("形式が不正です");
  }
  if (header.alg !== "RS256" || !header.kid) throw new IdTokenError("署名方式が不正です");

  const jwk = (await fetchJwks()).find((k) => k.kid === header.kid);
  if (!jwk) throw new IdTokenError("署名鍵が見つかりません");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new IdTokenError("署名が不正です");

  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new IdTokenError("発行者が不正です");
  if (claims.aud !== clientId) throw new IdTokenError("宛先が不正です");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SEC < nowSec) {
    throw new IdTokenError("有効期限切れです");
  }
  if (!claims.sub || !claims.email) throw new IdTokenError("必要な情報がありません");
  return claims;
}

let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;

/** Google の公開鍵を取得する（Cache-Control に従ってメモリにキャッシュ） */
async function fetchGoogleJwks(): Promise<Jwk[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const res = await fetch(GOOGLE_JWKS_URL, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new IdTokenError(`公開鍵を取得できません（HTTP ${res.status}）`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const maxAge = Number(res.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 3600);
  jwksCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
}
