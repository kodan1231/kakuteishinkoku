import { OCR_PROMPT, type OcrLabResult, type ReceiptFields } from "../../shared/ocr";

const LLAMA_3_2_VISION = "@cf/meta/llama-3.2-11b-vision-instruct";

/** 画像（data URI）を指定モデルで読み取る */
export async function runReceiptOcr(ai: Ai, model: string, image: string): Promise<OcrLabResult> {
  const started = Date.now();
  try {
    const output = await runWithLicenseAgreement(ai, model, buildInput(model, image));
    const { text, usage } = extractText(output);
    return {
      model,
      ok: true,
      elapsedMs: Date.now() - started,
      fields: parseFields(text),
      usage,
      raw: text,
    };
  } catch (e) {
    return {
      model,
      ok: false,
      elapsedMs: Date.now() - started,
      fields: null,
      usage: null,
      raw: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function buildInput(model: string, image: string): Record<string, unknown> {
  const input: Record<string, unknown> = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_PROMPT },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
    max_tokens: 512,
    temperature: 0,
  };
  // 思考モードを持つモデルは無効化してトークン消費を抑える
  if (model.startsWith("@cf/google/gemma-4") || model.startsWith("@cf/moonshotai/") || model.startsWith("@cf/qwen/")) {
    input.chat_template_kwargs = { enable_thinking: false };
  }
  return input;
}

/** Llama 3.2 Vision は初回にライセンス同意（"agree"）の送信が必要 */
async function runWithLicenseAgreement(ai: Ai, model: string, input: Record<string, unknown>): Promise<unknown> {
  const run = (body: Record<string, unknown>) => (ai.run as (m: string, i: unknown) => Promise<unknown>)(model, body);
  try {
    return await run(input);
  } catch (e) {
    if (model !== LLAMA_3_2_VISION || !(e instanceof Error) || !/agree/i.test(e.message)) throw e;
    await run({ prompt: "agree" });
    return await run(input);
  }
}

/** 旧形式（{ response }）と Chat Completions 形式（{ choices }）の両方に対応 */
function extractText(output: unknown): { text: string; usage: OcrLabResult["usage"] } {
  const o = output as {
    response?: unknown;
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const usage = o.usage
    ? { promptTokens: o.usage.prompt_tokens, completionTokens: o.usage.completion_tokens }
    : null;
  if (o.choices?.[0]?.message) {
    return { text: stringify(o.choices[0].message.content), usage };
  }
  return { text: stringify(o.response ?? output), usage };
}

function stringify(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** 応答テキストから最初の JSON オブジェクトを取り出して正規化する */
export function parseFields(text: string): ReceiptFields | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const payee = typeof obj.payee === "string" && obj.payee.trim() ? obj.payee.trim() : null;
  const listed = Array.isArray(obj.payee_candidates)
    ? obj.payee_candidates.filter((p): p is string => typeof p === "string").map((p) => p.trim())
    : [];
  const payeeCandidates = [...new Set([payee, ...listed].filter((p): p is string => !!p))].slice(0, MAX_PAYEE_CANDIDATES);
  const uncertain = Array.isArray(obj.uncertain)
    ? UNCERTAIN_FIELDS.filter((f) => (obj.uncertain as unknown[]).includes(f))
    : [];
  return {
    date: normalizeDate(obj.date),
    payee: payee ?? payeeCandidates[0] ?? null,
    payeeCandidates,
    amount: normalizeAmount(obj.amount),
    category: typeof obj.category === "string" ? obj.category : null,
    confidence: typeof obj.confidence === "string" ? obj.confidence : null,
    uncertain,
  };
}

const MAX_PAYEE_CANDIDATES = 3;
const UNCERTAIN_FIELDS = ["date", "payee", "amount"] as const;

function normalizeDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function normalizeAmount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && /\d/.test(v)) {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}
