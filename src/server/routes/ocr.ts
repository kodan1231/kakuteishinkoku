import { Hono } from "hono";
import { buildOcrPrompt, OCR_DAILY_LIMIT, OCR_MODEL, type OcrRequest, type OcrResponse, type OcrUsage } from "../../shared/ocr";
import type { AppEnv } from "../env";
import { consumeOcrUsage, getOcrUsage, jstDate, refundOcrUsage } from "../lib/db";
import { runReceiptOcr } from "../lib/ocr";
import { requireUser } from "../middleware/requireUser";

/** 領収書の読み取り。画像は保存せず、読み取り結果だけを返す */
export const ocr = new Hono<AppEnv>();

const MAX_IMAGE_CHARS = 2_000_000; // data URI で約1.5MB

ocr.use(requireUser);

function toUsage(used: number): OcrUsage {
  return { used, limit: OCR_DAILY_LIMIT, remaining: Math.max(OCR_DAILY_LIMIT - used, 0) };
}

ocr.get("/usage", async (c) => {
  return c.json(toUsage(await getOcrUsage(c.env.DB, c.get("user").id, jstDate(Date.now()))));
});

ocr.post("/", async (c) => {
  const body = await c.req.json<OcrRequest>().catch(() => null);
  if (typeof body?.image !== "string" || !body.image.startsWith("data:image/") || body.image.length > MAX_IMAGE_CHARS) {
    return c.json({ error: "画像が不正です" }, 400);
  }
  const userId = c.get("user").id;
  const date = jstDate(Date.now());
  const used = await consumeOcrUsage(c.env.DB, userId, date, OCR_DAILY_LIMIT);
  if (used === null) {
    return c.json({ error: `今日の読み取り回数の上限（${OCR_DAILY_LIMIT}回）に達しました。手入力してください`, code: "limit" }, 429);
  }
  const result = await runReceiptOcr(c.env.AI, OCR_MODEL, body.image, buildOcrPrompt(body.knownPayees));
  if (!result.ok) {
    await refundOcrUsage(c.env.DB, userId, date);
    console.error("OCR failed", result.error);
    return c.json({ error: "読み取りに失敗しました。もう一度試すか、手入力してください" }, 502);
  }
  return c.json({ fields: result.fields, usage: toUsage(used) } satisfies OcrResponse);
});
