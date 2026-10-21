import type { Env } from "../env";
import { createAdmin, createUserWithInvite, findUserBySub, toAppUser, touchUser } from "./db";
import { sha256Hex } from "./crypto";
import type { GoogleIdClaims } from "./idToken";
import type { AppUser } from "../../shared/auth";

export type ResolveResult =
  | { ok: true; user: AppUser }
  | { ok: false; reason: "disabled" | "not_invited" };

/**
 * ID トークンの持ち主がアプリを使えるか判定し、必要なら登録する。
 * - 登録済みで有効 → 利用可
 * - 未登録で ADMIN_EMAIL と一致（メール確認済み） → 管理者として登録
 * - 未登録で有効な招待トークンあり → 一般ユーザーとして登録
 */
export async function resolveUser(
  env: Env,
  claims: GoogleIdClaims,
  inviteToken: string | undefined,
  now: number,
): Promise<ResolveResult> {
  const displayName = claims.name ?? null;
  const existing = await findUserBySub(env.DB, claims.sub);
  if (existing) {
    if (existing.status !== "active") return { ok: false, reason: "disabled" };
    return { ok: true, user: toAppUser(await touchUser(env.DB, existing, claims.email, displayName, now)) };
  }

  if (claims.email_verified && isAdminEmail(env, claims.email)) {
    return { ok: true, user: toAppUser(await createAdmin(env.DB, claims.sub, claims.email, displayName, now)) };
  }

  if (inviteToken) {
    const row = await createUserWithInvite(
      env.DB,
      await sha256Hex(inviteToken),
      claims.sub,
      claims.email,
      displayName,
      now,
    );
    if (row) return { ok: true, user: toAppUser(row) };
  }
  return { ok: false, reason: "not_invited" };
}

function isAdminEmail(env: Env, email: string): boolean {
  return !!env.ADMIN_EMAIL && env.ADMIN_EMAIL.trim().toLowerCase() === email.toLowerCase();
}
