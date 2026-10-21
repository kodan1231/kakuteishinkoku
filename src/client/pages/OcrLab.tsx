import { useState } from "react";
import { OCR_CANDIDATE_MODELS, type OcrLabResult } from "../../shared/ocr";
import { resizeToDataUrl } from "../lib/image";
import { loadString, saveString } from "../lib/storage";

/**
 * Step 0: Workers AI の各モデルで領収書の読み取り精度を比較する検証ページ。
 * 画像は端末で縮小して送るだけで、サーバーには保存しない。
 */

const KEY_STORAGE = "ocrLab.key";
const OCR_MAX_EDGE = 1024;

interface Expected {
  date: string;
  payee: string;
  amount: string;
}

interface LabImage {
  id: string;
  name: string;
  dataUrl: string;
  sizeKb: number;
  expected: Expected;
  results: Record<string, OcrLabResult | "pending">;
}

export function OcrLab() {
  const [key, setKey] = useState(() => loadString(KEY_STORAGE) ?? "");
  const [models, setModels] = useState<string[]>(() => OCR_CANDIDATE_MODELS.slice(0, 5).map((m) => m.id));
  const [images, setImages] = useState<LabImage[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  const updateImage = (id: string, f: (img: LabImage) => LabImage) =>
    setImages((list) => list.map((img) => (img.id === id ? f(img) : img)));

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const added: LabImage[] = [];
    for (const file of Array.from(files)) {
      const dataUrl = await resizeToDataUrl(file, OCR_MAX_EDGE);
      added.push({
        id: crypto.randomUUID(),
        name: file.name,
        dataUrl,
        sizeKb: Math.round((dataUrl.length * 3) / 4 / 1024),
        expected: { date: "", payee: "", amount: "" },
        results: {},
      });
    }
    setImages((list) => [...list, ...added]);
  }

  async function runAll() {
    saveString(KEY_STORAGE, key);
    setRunning(true);
    setMessage("");
    try {
      for (const img of images) {
        for (const model of models) {
          updateImage(img.id, (i) => ({ ...i, results: { ...i.results, [model]: "pending" } }));
          const result = await callOcr(key, model, img.dataUrl);
          updateImage(img.id, (i) => ({ ...i, results: { ...i.results, [model]: result } }));
          if (result.error === "合言葉が違います") {
            setMessage(result.error);
            return;
          }
        }
      }
      setMessage("完了しました");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 text-sm">
      <h1 className="text-xl font-bold">OCR 検証（Step 0）</h1>

      <section className="space-y-2">
        <label className="block">
          合言葉
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1"
          />
        </label>
        <fieldset>
          <legend>比較するモデル</legend>
          {OCR_CANDIDATE_MODELS.map((m) => (
            <label key={m.id} className="mr-4 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={models.includes(m.id)}
                onChange={(e) =>
                  setModels((list) => (e.target.checked ? [...list, m.id] : list.filter((x) => x !== m.id)))
                }
              />
              {m.label}
            </label>
          ))}
        </fieldset>
        <input type="file" accept="image/*" multiple onChange={(e) => addFiles(e.target.files)} />
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={running || !key || images.length === 0 || models.length === 0}
            onClick={runAll}
            className="rounded bg-teal-700 px-4 py-2 text-white disabled:opacity-40"
          >
            {running ? "実行中…" : `読み取り実行（${images.length}枚 × ${models.length}モデル）`}
          </button>
          <span>{message}</span>
        </div>
      </section>

      {images.length > 0 && <Summary images={images} models={models} />}

      {images.map((img) => (
        <section key={img.id} className="space-y-2 rounded border p-3">
          <div className="flex flex-wrap items-start gap-4">
            <img src={img.dataUrl} alt={img.name} className="max-h-64 rounded border" />
            <div className="space-y-1">
              <div className="font-semibold">
                {img.name}（送信サイズ 約{img.sizeKb}KB）
              </div>
              <div className="text-gray-600">正解（入力すると一致判定します）</div>
              {(["date", "payee", "amount"] as const).map((field) => (
                <input
                  key={field}
                  placeholder={{ date: "2026-01-15", payee: "支払先", amount: "金額" }[field]}
                  value={img.expected[field]}
                  onChange={(e) =>
                    updateImage(img.id, (i) => ({ ...i, expected: { ...i.expected, [field]: e.target.value } }))
                  }
                  className="block w-56 rounded border px-2 py-1"
                />
              ))}
              <button
                type="button"
                onClick={() => setImages((list) => list.filter((i) => i.id !== img.id))}
                className="text-red-700 underline"
              >
                この画像を外す
              </button>
            </div>
          </div>
          <ResultTable image={img} models={models} />
        </section>
      ))}
    </main>
  );
}

async function callOcr(key: string, model: string, image: string): Promise<OcrLabResult> {
  const started = Date.now();
  try {
    const res = await fetch("/api/lab/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Lab-Key": key },
      body: JSON.stringify({ model, image }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as OcrLabResult;
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

type Match = boolean | null; // null = 正解未入力

function judge(img: LabImage, r: OcrLabResult): { date: Match; payee: Match; amount: Match } {
  const f = r.fields;
  const e = img.expected;
  const norm = (s: string) => s.replace(/\s/g, "");
  return {
    date: e.date ? f?.date === e.date : null,
    payee: e.payee ? !!f?.payee && norm(f.payee).includes(norm(e.payee)) : null,
    amount: e.amount ? f?.amount === Number(e.amount.replace(/[^\d]/g, "")) : null,
  };
}

function Summary({ images, models }: { images: LabImage[]; models: string[] }) {
  return (
    <section>
      <h2 className="font-semibold">モデル別の集計</h2>
      <table className="mt-1 w-full border-collapse text-left">
        <thead>
          <tr className="border-b">
            <th className="py-1">モデル</th>
            <th>日付</th>
            <th>支払先</th>
            <th>金額</th>
            <th>失敗</th>
            <th>平均時間</th>
            <th>平均トークン（入力/出力）</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const done = images
              .map((img) => ({ img, r: img.results[model] }))
              .filter((x): x is { img: LabImage; r: OcrLabResult } => !!x.r && x.r !== "pending");
            const count = (field: "date" | "payee" | "amount") => {
              const judged = done.map(({ img, r }) => judge(img, r)[field]).filter((m) => m !== null);
              return judged.length ? `${judged.filter(Boolean).length}/${judged.length}` : "-";
            };
            const avg = (values: (number | undefined)[]) => {
              const v = values.filter((x): x is number => typeof x === "number");
              return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : "-";
            };
            return (
              <tr key={model} className="border-b">
                <td className="py-1">{labelOf(model)}</td>
                <td>{count("date")}</td>
                <td>{count("payee")}</td>
                <td>{count("amount")}</td>
                <td>{done.filter(({ r }) => !r.ok || !r.fields).length}</td>
                <td>{done.length ? `${avg(done.map(({ r }) => r.elapsedMs))}ms` : "-"}</td>
                <td>
                  {avg(done.map(({ r }) => r.usage?.promptTokens))} / {avg(done.map(({ r }) => r.usage?.completionTokens))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function ResultTable({ image, models }: { image: LabImage; models: string[] }) {
  const cell = (value: string | number | null | undefined, match: Match) => (
    <td className={match === true ? "bg-green-100" : match === false ? "bg-red-100" : ""}>{value ?? "—"}</td>
  );
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b">
          <th className="py-1">モデル</th>
          <th>日付</th>
          <th>支払先</th>
          <th>金額</th>
          <th>区分</th>
          <th>確信度</th>
          <th>時間</th>
          <th>応答</th>
        </tr>
      </thead>
      <tbody>
        {models.map((model) => {
          const r = image.results[model];
          if (!r) return null;
          if (r === "pending") {
            return (
              <tr key={model} className="border-b">
                <td className="py-1">{labelOf(model)}</td>
                <td colSpan={7}>読み取り中…</td>
              </tr>
            );
          }
          const m = judge(image, r);
          return (
            <tr key={model} className="border-b align-top">
              <td className="py-1">{labelOf(model)}</td>
              {r.ok ? (
                <>
                  {cell(r.fields?.date, m.date)}
                  {cell(r.fields?.payee, m.payee)}
                  {cell(r.fields?.amount?.toLocaleString(), m.amount)}
                  <td>{r.fields?.category ?? "—"}</td>
                  <td>{r.fields?.confidence ?? "—"}</td>
                </>
              ) : (
                <td colSpan={5} className="text-red-700">
                  {r.error}
                </td>
              )}
              <td>{r.elapsedMs}ms</td>
              <td>
                <details>
                  <summary>表示</summary>
                  <pre className="max-w-xs whitespace-pre-wrap break-all text-xs">{r.raw}</pre>
                </details>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function labelOf(model: string): string {
  return OCR_CANDIDATE_MODELS.find((m) => m.id === model)?.label ?? model;
}
