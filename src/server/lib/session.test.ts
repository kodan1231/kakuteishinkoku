import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import initSql from "../../../migrations/0001_init.sql?raw";
import type { Env } from "../env";
import { sha256Hex } from "./crypto";
import { insertInvitation, setUserStatus } from "./db";
import type { GoogleIdClaims } from "./idToken";
import { resolveUser } from "./session";

// ローカルの D1（メモリ上）に対してユーザー登録・招待消費の挙動を確認する
let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let env: Env;
const NOW = 1_800_000_000_000;

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: "src/server/lib/wrangler.test.jsonc", persist: false });
  env = { DB: proxy.env.DB, ADMIN_EMAIL: "Admin@Example.com", GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x" } as Env;
});

afterAll(async () => {
  await proxy?.dispose();
});

beforeEach(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS ocr_usage; DROP TABLE IF EXISTS invitations; DROP TABLE IF EXISTS allowed_users;");
  const sql = initSql.replace(/--.*$/gm, "");
  for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    await env.DB.prepare(stmt).run();
  }
});

function claims(sub: string, email: string, emailVerified = true): GoogleIdClaims {
  return { sub, email, email_verified: emailVerified, name: email, aud: "x", iss: "https://accounts.google.com", exp: 0, iat: 0 };
}

async function seedAdminAndInvite(token: string, expiresAt = NOW + 1000) {
  const admin = await resolveUser(env, claims("admin", "admin@example.com"), undefined, NOW);
  if (!admin.ok) throw new Error("admin");
  await insertInvitation(env.DB, {
    id: crypto.randomUUID(),
    tokenHash: await sha256Hex(token),
    memo: null,
    createdBy: admin.user.id,
    expiresAt,
    createdAt: NOW,
  });
  return admin.user;
}

describe("resolveUser", () => {
  it("ADMIN_EMAIL と一致するアカウントは管理者として登録される（大文字小文字を区別しない）", async () => {
    const r = await resolveUser(env, claims("admin", "admin@example.com"), undefined, NOW);
    expect(r).toMatchObject({ ok: true, user: { role: "admin" } });
  });

  it("メール未確認なら ADMIN_EMAIL でも登録しない", async () => {
    const r = await resolveUser(env, claims("admin", "admin@example.com", false), undefined, NOW);
    expect(r).toEqual({ ok: false, reason: "not_invited" });
  });

  it("招待なしの未登録アカウントは拒否", async () => {
    expect(await resolveUser(env, claims("u1", "u1@example.com"), undefined, NOW)).toEqual({
      ok: false,
      reason: "not_invited",
    });
  });

  it("招待は1回だけ使え、2人目は登録されない", async () => {
    await seedAdminAndInvite("tok");
    expect(await resolveUser(env, claims("u1", "u1@example.com"), "tok", NOW)).toMatchObject({
      ok: true,
      user: { role: "user", email: "u1@example.com" },
    });
    expect(await resolveUser(env, claims("u2", "u2@example.com"), "tok", NOW)).toEqual({
      ok: false,
      reason: "not_invited",
    });
    const { results } = await env.DB.prepare("SELECT google_sub FROM allowed_users ORDER BY google_sub").all();
    expect(results.map((r) => r.google_sub)).toEqual(["admin", "u1"]);
  });

  it("期限切れの招待では登録されない", async () => {
    await seedAdminAndInvite("old", NOW - 1);
    expect(await resolveUser(env, claims("u1", "u1@example.com"), "old", NOW)).toEqual({
      ok: false,
      reason: "not_invited",
    });
  });

  it("登録済みなら招待なしでログインでき、利用停止後は拒否", async () => {
    await seedAdminAndInvite("tok");
    const first = await resolveUser(env, claims("u1", "u1@example.com"), "tok", NOW);
    if (!first.ok) throw new Error("setup");
    expect(await resolveUser(env, claims("u1", "new@example.com"), undefined, NOW)).toMatchObject({
      ok: true,
      user: { email: "new@example.com" },
    });
    await setUserStatus(env.DB, first.user.id, "disabled");
    expect(await resolveUser(env, claims("u1", "u1@example.com"), undefined, NOW)).toEqual({
      ok: false,
      reason: "disabled",
    });
  });
});
