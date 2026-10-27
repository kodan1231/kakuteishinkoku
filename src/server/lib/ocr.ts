import { OCR_PROMPT, type OcrLabResult, type ReceiptFields } from "../../shared/ocr";

const LLAMA_3_2_VISION = "@cf/meta/llama-3.2-11b-vision-instruct";

/** 画像（data URI）を指定モデルで読み取る */
export async function runReceiptOcr(ai: Ai, model: string, image: string, prompt = OCR_PROMPT): Promise<OcrLabResult> {
  const started = Date.now();
  try {
    const output = await runWithLicenseAgreement(ai, model, buildInput(model, image, prompt));
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

function buildInput(model: string, image: string, prompt: string): Record<string, unknown> {
  const input: Record<string, unknown> = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
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

/** 和暦の元号と、その元年の前年（元号の年 + この値 = 西暦） */
const ERAS: { pattern: RegExp; offset: number }[] = [
  { pattern: /^(令和|令|R)/i, offset: 2018 },
  { pattern: /^(平成|平|H)/i, offset: 1988 },
  { pattern: /^(昭和|昭|S)/i, offset: 1925 },
];

/**
 * 領収書の表記どおりの日付（和暦・西暦）を YYYY-MM-DD にする。
 * 和暦の換算は AI に任せると誤ることがあるため、ここで行う。
 */
export function parseDateText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s/g, "")
    .replace(/元年/, "1年");
  for (const era of ERAS) {
    const m = s.match(era.pattern);
    if (!m) continue;
    const d = s.slice(m[0].length).match(/^(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})/);
    return d ? toIsoDate(Number(d[1]) + era.offset, d[2], d[3]) : null;
  }
  const d = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return d ? toIsoDate(Number(d[1]), d[2], d[3]) : null;
}

function toIsoDate(year: number, month: string, day: string): string | null {
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 読み取った年が今年より先、または還付申告の期限（5年）より前なら、日付に自信がないものとする */
const PLAUSIBLE_PAST_YEARS = 6;

/** 応答テキストから最初の JSON オブジェクトを取り出して正規化する */
export function parseFields(text: string, now = new Date()): ReceiptFields | null {
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
  const date = parseDateText(obj.date_text) ?? normalizeDate(obj.date);
  const year = date ? Number(date.slice(0, 4)) : null;
  const implausible = year !== null && (year > now.getFullYear() || year < now.getFullYear() - PLAUSIBLE_PAST_YEARS);
  const uncertain = UNCERTAIN_FIELDS.filter(
    (f) => (Array.isArray(obj.uncertain) && obj.uncertain.includes(f)) || (f === "date" && implausible),
  );
  return {
    date,
    payee: payee ?? payeeCandidates[0] ?? null,
    payeeCandidates,
    amount: normalizeAmount(obj.amount),
    category: typeof obj.category === "string" ? obj.category : null,
    confidence: typeof obj.confidence === "string" ? obj.confidence : null,
    uncertain,
    patient: typeof obj.patient === "string" && obj.patient.trim() ? obj.patient.trim().replace(/\s*(様|殿)$/, "") : null,
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
