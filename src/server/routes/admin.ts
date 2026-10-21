import { Hono } from "hono";
import {
  INVITE_DEFAULT_DAYS,
  INVITE_MAX_DAYS,
  type CreatedInvitation,
  type UserStatus,
} from "../../shared/auth";
import type { AppEnv } from "../env";
import { randomToken, sha256Hex } from "../lib/crypto";
import { insertInvitation, listInvitations, listUsers, revokeInvitation, setUserStatus } from "../lib/db";
import { requireAdmin, requireUser } from "../middleware/requireUser";

const DAY_MS = 24 * 60 * 60 * 1000;

export const admin = new Hono<AppEnv>();

admin.use(requireUser, requireAdmin);

admin.get("/invites", async (c) => c.json(await listInvitations(c.env.DB)));

admin.post("/invites", async (c) => {
  const body = await c.req.json<{ memo?: string; days?: number }>().catch(() => ({}) as { memo?: string; days?: number });
  const days = Math.min(Math.max(Math.floor(body.days ?? INVITE_DEFAULT_DAYS), 1), INVITE_MAX_DAYS);
  const memo = body.memo?.trim().slice(0, 100) || null;
  const token = randomToken();
  const now = Date.now();
  const inv = { id: crypto.randomUUID(), tokenHash: await sha256Hex(token), memo, createdBy: c.get("user").id, expiresAt: now + days * DAY_MS, createdAt: now };
  await insertInvitation(c.env.DB, inv);
  const res: CreatedInvitation = {
    id: inv.id,
    memo,
    createdAt: now,
    expiresAt: inv.expiresAt,
    usedAt: null,
    usedByEmail: null,
    revokedAt: null,
    token,
  };
  return c.json(res, 201);
});

admin.delete("/invites/:id", async (c) => {
  const ok = await revokeInvitation(c.env.DB, c.req.param("id"), Date.now());
  return ok ? c.json({ ok: true }) : c.json({ error: "取り消せない招待です" }, 409);
});

admin.get("/users", async (c) => c.json(await listUsers(c.env.DB)));

admin.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ status?: UserStatus }>().catch(() => ({}) as { status?: UserStatus });
  if (body.status !== "active" && body.status !== "disabled") return c.json({ error: "リクエストが不正です" }, 400);
  if (id === c.get("user").id) return c.json({ error: "自分自身は変更できません" }, 400);
  const ok = await setUserStatus(c.env.DB, id, body.status);
  return ok ? c.json({ ok: true }) : c.json({ error: "ユーザーが見つかりません" }, 404);
});
