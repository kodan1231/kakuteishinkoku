import { MEDICAL_CATEGORIES } from "./medical";

/** 領収書から読み取る項目 */
export interface ReceiptFields {
  date: string | null; // YYYY-MM-DD
  payee: string | null;
  /** 支払先の候補（確からしい順。先頭は payee と同じ） */
  payeeCandidates: string[];
  amount: number | null;
  category: string | null;
  confidence: string | null;
  /** 読み取りに自信がない項目 */
  uncertain: ("date" | "payee" | "amount")[];
  /** 患者名（宛名）。家族設定の名前と照らし合わせて医療を受けた人を選ぶ */
  patient: string | null;
}

/** 読み取りのときに AI に伝える過去の支払先の上限 */
export const OCR_KNOWN_PAYEES_MAX = 30;
const KNOWN_PAYEE_MAX_LENGTH = 40;

/** 本番の読み取りに使うモデル（Step 0 の検証で決定） */
export const OCR_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
/** 1人1日あたりの読み取り回数の上限（日付は日本時間） */
export const OCR_DAILY_LIMIT = 30;
/** 読み取り用に縮小する画像の長辺（px） */
export const OCR_IMAGE_MAX_EDGE = 1024;

export interface OcrRequest {
  /** data:image/jpeg;base64,... 形式 */
  image: string;
  /** 過去の支払先（近い表記があれば AI にそれを使わせる） */
  knownPayees?: string[];
}

export interface OcrUsage {
  used: number;
  limit: number;
  remaining: number;
}

export interface OcrResponse {
  /** 読み取れなかった場合は null */
  fields: ReceiptFields | null;
  usage: OcrUsage;
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

{"date_text": "支払日（領収書の表記どおり）", "payee": "発行元の名称", "payee_candidates": ["発行元の候補（確からしい順、最大3つ）"], "amount": 支払った合計金額（円、整数）, "category": "区分", "patient": "患者名", "confidence": "high|medium|low", "uncertain": ["自信がない項目（date / payee / amount）"]}

ルール:
- date_text は和暦・西暦を変換せず、領収書に書かれたとおりに書く（例: "令和8年2月3日"、"R8.2.3"、"2026/02/03"）。発行日・診療日・領収日があれば領収日（なければ発行日）を使う
- payee はこの領収書を発行した病院・クリニック・薬局・店舗の名称。押印・住所・電話番号の近くに書かれていることが多い
  - 調剤薬局の領収書にある「保険医療機関」「処方元」などの病院名は発行元ではないので payee にしない（候補の2番目以降に入れてよい）
  - 患者名・宛名・会社名は payee にも候補にも入れない
  - 名称は省略せず、領収書の表記どおりに書く
- payee_candidates には、領収書に書かれた医療機関・薬局の名称を確からしい順に入れる（先頭は payee と同じ）
- amount は「合計」「領収金額」「お支払い」「請求額」の金額を優先する。カンマや「円」「¥」は付けない
- category は次のいずれか: ${[...MEDICAL_CATEGORIES, "医療費以外"].join(" / ")}
  - 病院・クリニック・歯科の窓口支払い → 診療・治療
  - 薬局・調剤薬局・ドラッグストアでの支払い（処方箋による調剤を含む） → 医薬品購入
- patient は「患者氏名」「氏名」「様」の付いた宛名など、医療を受けた人の名前。漢字の氏名があれば漢字（フリガナではなく）、「様」は付けない
- 読み取れない項目は null にする
- confidence は読み取り全体の確からしさ。uncertain には、かすれ・手書き・複数の候補などで自信がない項目を入れる`;

/** 過去の支払先を添えた読み取りの指示（領収書の表記と近ければ、その表記を使わせる） */
export function buildOcrPrompt(knownPayees: unknown): string {
  const payees = Array.isArray(knownPayees)
    ? [
        ...new Set(
          knownPayees
            .filter((p): p is string => typeof p === "string")
            .map((p) => p.trim().slice(0, KNOWN_PAYEE_MAX_LENGTH))
            .filter(Boolean),
        ),
      ].slice(0, OCR_KNOWN_PAYEES_MAX)
    : [];
  if (payees.length === 0) return OCR_PROMPT;
  return `${OCR_PROMPT}
- この利用者の過去の支払先: ${payees.map((p) => JSON.stringify(p)).join("、")}
  領収書の発行元がこのどれかと同じ（読み取りの揺れや表記の違いだけ）と判断できる場合は、payee にその表記を使う。違う支払先なら無理に合わせない`;
}
