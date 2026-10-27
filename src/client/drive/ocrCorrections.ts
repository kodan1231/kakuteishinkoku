/**
 * 写真の読み取りで支払先を手で直した記録と、それを使った支払先の候補づくり。
 * 自動では置き換えず、候補として表示して利用者に選んでもらう。
 */

export interface OcrCorrection {
  /** 読み取った支払先 */
  read: string;
  /** 利用者が直した支払先 */
  corrected: string;
  count: number;
  updatedAt: string;
}

export interface OcrCorrectionsData {
  version: 1;
  corrections: OcrCorrection[];
}

export function emptyCorrections(): OcrCorrectionsData {
  return { version: 1, corrections: [] };
}

export function parseCorrections(text: string): OcrCorrectionsData {
  try {
    const data = JSON.parse(text) as Partial<OcrCorrectionsData>;
    const corrections = Array.isArray(data.corrections)
      ? data.corrections.filter(
          (c): c is OcrCorrection => !!c && typeof c.read === "string" && typeof c.corrected === "string",
        )
      : [];
    return { version: 1, corrections };
  } catch {
    return emptyCorrections();
  }
}

const SMALL_KANA: Record<string, string> = {
  ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ッ: "ツ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ヮ: "ワ", ヵ: "カ", ヶ: "ケ",
};

/** 表記ゆれを無視して比べるための形（全角半角・ひらがなカタカナ・小書き文字・長音・空白・記号） */
export function normalizePayee(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[ァィゥェォッャュョヮヵヶ]/g, (c) => SMALL_KANA[c] ?? c)
    .replace(/[\sー－\-‐・･.,、。()（）「」]/g, "")
    .toLowerCase();
}

/** 編集距離（1文字の追加・削除・置換を1と数える） */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** 似ているとみなす違いの文字数（短い名前で別の支払先に寄らないよう、長さに応じて減らす） */
function similarityLimit(length: number): number {
  if (length <= 3) return 1;
  return 2;
}

export type PayeeCandidateSource = "correction" | "past" | "ocr";

export interface PayeeCandidate {
  name: string;
  source: PayeeCandidateSource;
}

/**
 * 支払先の候補。以前の修正 → 似た過去の支払先 → 読み取り結果の順に並べ、重複は除く。
 * pastPayees は新しい順。
 */
export function payeeCandidates(
  ocrCandidates: string[],
  corrections: OcrCorrection[],
  pastPayees: string[],
): PayeeCandidate[] {
  const reads = ocrCandidates.map(normalizePayee).filter(Boolean);
  const result: PayeeCandidate[] = [];
  const add = (name: string, source: PayeeCandidateSource) => {
    if (name && !result.some((c) => c.name === name)) result.push({ name, source });
  };
  [...corrections]
    .filter((c) => reads.includes(normalizePayee(c.read)))
    .sort((a, b) => b.count - a.count || b.updatedAt.localeCompare(a.updatedAt))
    .forEach((c) => add(c.corrected, "correction"));
  for (const p of pastPayees) {
    const n = normalizePayee(p);
    if (n && reads.some((r) => editDistance(r, n) <= similarityLimit(Math.min([...r].length, [...n].length)))) {
      add(p, "past");
    }
  }
  ocrCandidates.forEach((p) => add(p.trim(), "ocr"));
  return result;
}

/**
 * 領収書の患者名に一致する家族の id。表記ゆれを除いて同じ名前 → 片方がもう片方を含む（名前だけ・苗字だけの表記）
 * → 1文字違い、の順に探し、1人に決まらなければ null。
 */
export function matchFamilyMember(patient: string, family: { id: string; name: string }[]): string | null {
  const p = normalizePayee(patient.replace(/(様|殿)$/, ""));
  if (!p) return null;
  const names = family.map((f) => ({ id: f.id, n: normalizePayee(f.name) })).filter((f) => f.n);
  const pick = (hits: { id: string }[]) => (hits.length === 1 ? hits[0].id : null);
  const exact = names.filter((f) => f.n === p);
  if (exact.length > 0) return pick(exact);
  const contained = names.filter((f) => p.includes(f.n) || f.n.includes(p));
  if (contained.length > 0) return pick(contained);
  return pick(names.filter((f) => editDistance(f.n, p) <= 1));
}

/** 修正を記録する（同じ読み取り・修正の組なら回数を増やす） */
export function recordCorrection(data: OcrCorrectionsData, read: string, corrected: string, now: string): OcrCorrectionsData {
  const r = read.trim();
  const c = corrected.trim();
  if (!r || !c || normalizePayee(r) === normalizePayee(c)) return data;
  const existing = data.corrections.find((x) => normalizePayee(x.read) === normalizePayee(r) && x.corrected === c);
  const corrections = existing
    ? data.corrections.map((x) => (x === existing ? { ...x, count: x.count + 1, updatedAt: now } : x))
    : [...data.corrections, { read: r, corrected: c, count: 1, updatedAt: now }];
  return { version: 1, corrections };
}

export function removeCorrection(data: OcrCorrectionsData, read: string, corrected: string): OcrCorrectionsData {
  return { version: 1, corrections: data.corrections.filter((x) => !(x.read === read && x.corrected === corrected)) };
}
