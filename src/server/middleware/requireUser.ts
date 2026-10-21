import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { findUserBySub, toAppUser } from "../lib/db";
import { verifyGoogleIdToken } from "../lib/idToken";

/** Authorization: Bearer <Google の ID トークン> を検証し、許可リストと照合する */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return c.json({ error: "ログインが必要です" }, 401);
  let sub: string;
  try {
    sub = (await verifyGoogleIdToken(token, c.env.GOOGLE_CLIENT_ID)).sub;
  } catch {
    return c.json({ error: "ログインの有効期限が切れています" }, 401);
  }
  const row = await findUserBySub(c.env.DB, sub);
  if (!row || row.status !== "active") return c.json({ error: "利用が許可されていません" }, 403);
  c.set("user", toAppUser(row));
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("user").role !== "admin") return c.json({ error: "管理者のみ利用できます" }, 403);
  await next();
});
