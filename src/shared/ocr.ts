import { MEDICAL_CATEGORIES } from "./medical";

/** 領収書から読み取る項目 */
export interface ReceiptFields {
  date: string | null; // YYYY-MM-DD
  payee: string | null;
  amount: number | null;
  category: string | null;
  confidence: string | null;
}

export interface OcrLabRequest {
  model: string;
  /** data:image/jpeg;base64,... 形式 */
  image: string;
}

export interface OcrLabResult {
  model: string;
  ok: boolean;
  elapsedMs: number;
  fields: ReceiptFields | null;
  usage: { promptTokens?: number; completionTokens?: number } | null;
  raw: string;
  error?: string;
}

/** 検証ページで比較する候補モデル（Workers AI の画像入力対応モデル） */
export const OCR_CANDIDATE_MODELS = [
  { id: "@cf/meta/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
  { id: "@cf/google/gemma-3-12b-it", label: "Gemma 3 12B" },
  { id: "@cf/google/gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B" },
  { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1 24B" },
  { id: "@cf/meta/llama-3.2-11b-vision-instruct", label: "Llama 3.2 11B Vision" },
  { id: "@cf/moonshotai/kimi-k2.6", label: "Kimi K2.6（大型・消費大の可能性）" },
  { id: "@cf/qwen/qwen3.8-27b", label: "Qwen 3.8 27B（画像対応か要確認）" },
] as const;

export const OCR_PROMPT = `この画像は日本の領収書またはレシートです。次の項目を読み取り、JSON オブジェクトだけを出力してください。説明文やコードブロックは不要です。

{"date": "支払日（YYYY-MM-DD）", "payee": "発行元（病院・薬局・店舗などの名称）", "amount": 支払った合計金額（円、整数）, "category": "区分", "confidence": "high|medium|low"}

ルール:
- 和暦（令和など）は西暦に変換する
- amount は「合計」「領収金額」「お支払い」「請求額」の金額を優先する。カンマや「円」「¥」は付けない
- category は次のいずれか: ${[...MEDICAL_CATEGORIES, "医療費以外"].join(" / ")}
  - 病院・クリニック・歯科の窓口支払い → 診療・治療
  - 薬局・ドラッグストアでの薬 → 医薬品購入
- 読み取れない項目は null にする
- confidence は読み取り全体の確からしさ`;
