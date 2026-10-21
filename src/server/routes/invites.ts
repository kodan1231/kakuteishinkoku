import { Hono } from "hono";
import type { InviteStatus } from "../../shared/auth";
import type { AppEnv } from "../env";
import { sha256Hex } from "../lib/crypto";
import { findValidInvitation } from "../lib/db";

/** 招待URLを開いたときの有効性確認（ログイン不要） */
export const invites = new Hono<AppEnv>();

invites.get("/:token", async (c) => {
  const inv = await findValidInvitation(c.env.DB, await sha256Hex(c.req.param("token")), Date.now());
  const res: InviteStatus = inv ? { valid: true, expiresAt: inv.expires_at } : { valid: false };
  return c.json(res);
});
