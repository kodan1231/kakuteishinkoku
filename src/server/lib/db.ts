import type {
  AppUser,
  InvitationSummary,
  UserRole,
  UserStatus,
  UserSummary,
} from "../../shared/auth";

interface UserRow {
  id: string;
  google_sub: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: number;
  last_seen_at: number | null;
}

interface InvitationRow {
  id: string;
  memo: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_by_email: string | null;
  revoked_at: number | null;
}

export function toAppUser(row: UserRow): AppUser {
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}

export function findUserBySub(db: D1Database, sub: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM allowed_users WHERE google_sub = ?").bind(sub).first<UserRow>();
}

/** 日本時間の日付（YYYY-MM-DD）。OCR の利用回数の区切りに使う */
export function jstDate(now: number): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}

export async function getOcrUsage(db: D1Database, userId: string, date: string): Promise<number> {
  const row = await db.prepare("SELECT count FROM ocr_usage WHERE user_id = ? AND date = ?").bind(userId, date).first<{ count: number }>();
  return row?.count ?? 0;
}

/** 上限未満なら1回分を加算して加算後の回数を返す。上限に達していれば null */
export async function consumeOcrUsage(db: D1Database, userId: string, date: string, limit: number): Promise<number | null> {
  const row = await db
    .prepare(
      `INSERT INTO ocr_usage (user_id, date, count) VALUES (?1, ?2, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET count = count + 1 WHERE count < ?3
       RETURNING count`,
    )
    .bind(userId, date, limit)
    .first<{ count: number }>();
  return row?.count ?? null;
}

/** 読み取りに失敗したときは回数を戻す */
export async function refundOcrUsage(db: D1Database, userId: string, date: string): Promise<void> {
  await db.prepare("UPDATE ocr_usage SET count = count - 1 WHERE user_id = ? AND date = ? AND count > 0").bind(userId, date).run();
}

/** ログインのたびにメールアドレス・表示名・最終利用日時を更新する */
export async function touchUser(
  db: D1Database,
  row: UserRow,
  email: string,
  displayName: string | null,
  now: number,
): Promise<UserRow> {
  await db
    .prepare("UPDATE allowed_users SET email = ?, display_name = ?, last_seen_at = ? WHERE id = ?")
    .bind(email, displayName, now, row.id)
    .run();
  return { ...row, email, display_name: displayName, last_seen_at: now };
}

function newUserRow(sub: string, email: string, displayName: string | null, role: UserRole, now: number): UserRow {
  return {
    id: crypto.randomUUID(),
    google_sub: sub,
    email,
    display_name: displayName,
    role,
    status: "active",
    created_at: now,
    last_seen_at: now,
  };
}

function insertUser(db: D1Database, u: UserRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO allowed_users (id, google_sub, email, display_name, role, status, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(u.id, u.google_sub, u.email, u.display_name, u.role, u.status, u.created_at, u.last_seen_at);
}

export async function createAdmin(
  db: D1Database,
  sub: string,
  email: string,
  displayName: string | null,
  now: number,
): Promise<UserRow> {
  const row = newUserRow(sub, email, displayName, "admin", now);
  await insertUser(db, row).run();
  return row;
}

/**
 * 招待を使ってユーザーを登録する。招待が無効（使用済み・取消・期限切れ）なら null。
 * ユーザー作成と招待の消費を同じバッチで行い、招待を消費できなければユーザーを削除する。
 */
export async function createUserWithInvite(
  db: D1Database,
  tokenHash: string,
  sub: string,
  email: string,
  displayName: string | null,
  now: number,
): Promise<UserRow | null> {
  const row = newUserRow(sub, email, displayName, "user", now);
  const [, consume] = await db.batch([
    insertUser(db, row),
    db
      .prepare(
        `UPDATE invitations SET used_at = ?, used_by = ?
         WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(now, row.id, tokenHash, now),
  ]);
  if (consume.meta.changes === 1) return row;
  await db.prepare("DELETE FROM allowed_users WHERE id = ?").bind(row.id).run();
  return null;
}

export async function findValidInvitation(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<{ expires_at: number } | null> {
  return db
    .prepare(
      `SELECT expires_at FROM invitations
       WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<{ expires_at: number }>();
}

export async function insertInvitation(
  db: D1Database,
  inv: { id: string; tokenHash: string; memo: string | null; createdBy: string; expiresAt: number; createdAt: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO invitations (id, token_hash, memo, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(inv.id, inv.tokenHash, inv.memo, inv.createdBy, inv.expiresAt, inv.createdAt)
    .run();
}

export async function listInvitations(db: D1Database): Promise<InvitationSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.memo, i.created_at, i.expires_at, i.used_at, i.revoked_at, u.email AS used_by_email
       FROM invitations i LEFT JOIN allowed_users u ON u.id = i.used_by
       ORDER BY i.created_at DESC LIMIT 100`,
    )
    .all<InvitationRow>();
  return results.map((r) => ({
    id: r.id,
    memo: r.memo,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    usedByEmail: r.used_by_email,
    revokedAt: r.revoked_at,
  }));
}

/** 未使用の招待のみ取り消せる */
export async function revokeInvitation(db: D1Database, id: string, now: number): Promise<boolean> {
  const res = await db
    .prepare("UPDATE invitations SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL")
    .bind(now, id)
    .run();
  return res.meta.changes === 1;
}

export async function listUsers(db: D1Database): Promise<UserSummary[]> {
  const { results } = await db.prepare("SELECT * FROM allowed_users ORDER BY created_at").all<UserRow>();
  return results.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  }));
}

export async function setUserStatus(db: D1Database, id: string, status: UserStatus): Promise<boolean> {
  const res = await db.prepare("UPDATE allowed_users SET status = ? WHERE id = ?").bind(status, id).run();
  return res.meta.changes === 1;
}
