import { Hono } from "hono";
import { OCR_CANDIDATE_MODELS, type OcrLabRequest } from "../../shared/ocr";
import type { Env } from "../env";
import { runReceiptOcr } from "../lib/ocr";

/** Step 0 の OCR 精度比較用 API。本番の OCR API ができたら削除する */
export const ocrLab = new Hono<{ Bindings: Env }>();

const MAX_IMAGE_CHARS = 2_000_000; // data URI で約1.5MB

ocrLab.use(async (c, next) => {
  const key = c.env.OCR_LAB_KEY;
  if (!key) return c.notFound();
  if (c.req.header("X-Lab-Key") !== key) return c.json({ error: "合言葉が違います" }, 401);
  await next();
});

ocrLab.post("/", async (c) => {
  const body = await c.req.json<OcrLabRequest>();
  if (!OCR_CANDIDATE_MODELS.some((m) => m.id === body.model)) {
    return c.json({ error: "対象外のモデルです" }, 400);
  }
  if (typeof body.image !== "string" || !body.image.startsWith("data:image/") || body.image.length > MAX_IMAGE_CHARS) {
    return c.json({ error: "画像が不正です" }, 400);
  }
  return c.json(await runReceiptOcr(c.env.AI, body.model, body.image));
});
