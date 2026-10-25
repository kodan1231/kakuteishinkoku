import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import initSql from "../../../migrations/0001_init.sql?raw";
import { consumeOcrUsage, getOcrUsage, jstDate, refundOcrUsage } from "./db";

// ローカルの D1（メモリ上）で OCR の利用回数の加算・上限・差し戻しを確認する
let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: "src/server/lib/wrangler.test.jsonc", persist: false });
  db = proxy.env.DB;
});

afterAll(async () => {
  await proxy?.dispose();
});

beforeEach(async () => {
  await db.exec("DROP TABLE IF EXISTS ocr_usage; DROP TABLE IF EXISTS invitations; DROP TABLE IF EXISTS allowed_users;");
  const sql = initSql.replace(/--.*$/gm, "");
  for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
  await db
    .prepare("INSERT INTO allowed_users (id, google_sub, email, created_at) VALUES ('u1', 's1', 'a@example.com', 0)")
    .run();
});

describe("OCR の利用回数", () => {
  it("上限まで加算し、上限に達したら null", async () => {
    expect(await consumeOcrUsage(db, "u1", "2026-10-25", 2)).toBe(1);
    expect(await consumeOcrUsage(db, "u1", "2026-10-25", 2)).toBe(2);
    expect(await consumeOcrUsage(db, "u1", "2026-10-25", 2)).toBeNull();
    expect(await getOcrUsage(db, "u1", "2026-10-25")).toBe(2);
  });

  it("日付が変われば数え直す", async () => {
    await consumeOcrUsage(db, "u1", "2026-10-25", 1);
    expect(await consumeOcrUsage(db, "u1", "2026-10-26", 1)).toBe(1);
  });

  it("失敗時は1回分戻す（0未満にはしない）", async () => {
    await consumeOcrUsage(db, "u1", "2026-10-25", 5);
    await refundOcrUsage(db, "u1", "2026-10-25");
    await refundOcrUsage(db, "u1", "2026-10-25");
    expect(await getOcrUsage(db, "u1", "2026-10-25")).toBe(0);
  });
});

describe("jstDate", () => {
  it("日本時間の日付を返す", () => {
    expect(jstDate(Date.UTC(2026, 9, 24, 14, 59))).toBe("2026-10-24");
    expect(jstDate(Date.UTC(2026, 9, 24, 15, 0))).toBe("2026-10-25");
  });
});
