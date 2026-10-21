import { beforeAll, describe, expect, it } from "vitest";
import { base64UrlEncode } from "./crypto";
import { verifyGoogleIdToken } from "./idToken";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const NOW = 1_800_000_000;

let privateKey: CryptoKey;
let jwks: (JsonWebKey & { kid: string })[];

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  privateKey = pair.privateKey;
  jwks = [{ ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid: "k1" }];
});

async function sign(claims: Record<string, unknown>, kid = "k1"): Promise<string> {
  const enc = (o: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg: "RS256", kid, typ: "JWT" })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(input));
  return `${input}.${base64UrlEncode(new Uint8Array(sig))}`;
}

const valid = {
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  sub: "1234",
  email: "a@example.com",
  email_verified: true,
  iat: NOW - 10,
  exp: NOW + 3600,
};

const verify = (token: string) => verifyGoogleIdToken(token, CLIENT_ID, async () => jwks, NOW);

describe("verifyGoogleIdToken", () => {
  it("正しいトークンを受け入れる", async () => {
    await expect(verify(await sign(valid))).resolves.toMatchObject({ sub: "1234", email: "a@example.com" });
  });

  it("宛先（aud）が違うと拒否", async () => {
    await expect(verify(await sign({ ...valid, aud: "other" }))).rejects.toThrow("宛先");
  });

  it("発行者が違うと拒否", async () => {
    await expect(verify(await sign({ ...valid, iss: "https://evil.example.com" }))).rejects.toThrow("発行者");
  });

  it("期限切れは拒否", async () => {
    await expect(verify(await sign({ ...valid, exp: NOW - 120 }))).rejects.toThrow("有効期限");
  });

  it("改ざんされたトークンは拒否", async () => {
    const [h, , s] = (await sign(valid)).split(".");
    const forged = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ ...valid, sub: "9999" })));
    await expect(verify(`${h}.${forged}.${s}`)).rejects.toThrow("署名");
  });

  it("未知の鍵 ID は拒否", async () => {
    await expect(verify(await sign(valid, "unknown"))).rejects.toThrow("署名鍵");
  });
});
