import { useState } from "react";
import { Link } from "react-router";
import { buttonClass, ErrorText, inputClass, NoticeText, Page, subButtonClass, WarningText } from "../components/Layout";
import { driveFileUrl } from "../components/ReceiptPreview";
import { useReadyLedger } from "../drive/LedgerProvider";
import { isFinal, parseAmount } from "../drive/records";
import { estimateDeduction, summarize, type Subtotal } from "../drive/summary";
import templateUrl from "../export/iryouhi_form_v3.1.xlsx?url";
import { buildCsv, buildFormRows, buildFormXlsx, fileTimestamp, FORM_MAX_ROWS, type FormMode } from "../export/medicalForm";
import { saveToDevice } from "../lib/download";
import { formatYen } from "../lib/format";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface Output {
  name: string;
  blob: Blob;
  /** ドライブに保存できたときのファイル ID */
  fileId: string | null;
  driveError: string | null;
}

export function Summary() {
  const { year, records, family, allocation, income } = useReadyLedger();
  const summary = summarize(records, allocation, year, family);
  const { threshold, deduction } = estimateDeduction(summary.total.adjusted, income);
  return (
    <Page title={`${year}年分の集計・出力`}>
      <Link to="/" className="text-sm text-teal-700 underline">
        ← ホーム
      </Link>

      <section className="space-y-1 rounded border p-3">
        <div className="text-sm text-gray-600">医療費（{summary.total.count}件）</div>
        <div className="text-2xl font-bold">{formatYen(summary.total.adjusted)}</div>
        <div className="text-sm text-gray-600">
          支払額 {formatYen(summary.total.paid)}
          {summary.total.reimbursed > 0 && ` − 補填 ${formatYen(summary.total.reimbursed)}`}
        </div>
      </section>

      <section className="space-y-2 rounded border p-3">
        <div className="text-sm text-gray-600">医療費控除の見込額</div>
        <div className="text-2xl font-bold">{formatYen(deduction)}</div>
        <div className="text-sm text-gray-600">
          {formatYen(summary.total.adjusted)} − {formatYen(threshold)}
          {income === null ? "（10万円）" : "（10万円と総所得金額等の5%の少ないほう）"}
          {deduction === 2_000_000 && "、上限200万円"}
        </div>
        <IncomeForm />
        <p className="text-xs text-gray-500">
          所得から差し引かれる額の目安で、税金が戻る額ではありません。セルフメディケーション税制（特定の市販薬の控除）とは併用できず、どちらか一方を選びます。
        </p>
      </section>

      <SubtotalTable title="医療を受けた人別" rows={summary.byPerson} />
      <SubtotalTable title="区分別" rows={summary.byCategory} />
      <SubtotalTable title="月別" rows={summary.byMonth} />

      <ExportSection />
    </Page>
  );
}

function IncomeForm() {
  const { income, saveIncome } = useReadyLedger();
  const [value, setValue] = useState(income === null ? "" : String(income));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = value.trim() ? parseAmount(value) : null;
  const invalid = value.trim() !== "" && parsed === null;
  const changed = (parsed ?? null) !== income;
  return (
    <div className="space-y-1">
      <label className="block text-sm">
        総所得金額等（任意）
        <div className="flex gap-2">
          <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="例: 4500000" className={`${inputClass} mt-0`} />
          <button
            type="button"
            className={`${subButtonClass} shrink-0`}
            disabled={busy || invalid || !changed}
            onClick={() => {
              setBusy(true);
              setError(null);
              saveIncome(parsed)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
            }}
          >
            保存
          </button>
        </div>
      </label>
      {invalid && <p className="text-xs text-red-700">整数で入力してください</p>}
      {error && <ErrorText>{error}</ErrorText>}
      <p className="text-xs text-gray-500">
        会社員は源泉徴収票の「給与所得控除後の金額」が目安です。200万円未満の場合に入力すると、差し引く額が10万円より少なくなります。
      </p>
    </div>
  );
}

function SubtotalTable({ title, rows }: { title: string; rows: Subtotal[] }) {
  return (
    <section className="space-y-1">
      <h2 className="font-bold">{title}</h2>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500">
          <tr className="border-b">
            <th className="py-1 text-left font-normal" />
            <th className="py-1 text-right font-normal">件数</th>
            <th className="py-1 text-right font-normal">支払額</th>
            <th className="py-1 text-right font-normal">補填</th>
            <th className="py-1 text-right font-normal">調整後</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-b ${r.count === 0 ? "text-gray-400" : ""}`}>
              <td className="py-1">{r.label}</td>
              <td className="py-1 text-right">{r.count}</td>
              <td className="py-1 text-right">{r.paid.toLocaleString("ja-JP")}</td>
              <td className="py-1 text-right">{r.reimbursed.toLocaleString("ja-JP")}</td>
              <td className="py-1 text-right font-bold">{r.adjusted.toLocaleString("ja-JP")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ExportSection() {
  const { year, records, allocation, saveOutput } = useReadyLedger();
  const [mode, setMode] = useState<FormMode>("each");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<Output | null>(null);

  const drafts = records.filter((r) => !isFinal(r)).length;
  const excess = allocation.entries.filter((e) => e.excess > 0);
  const rowCount = buildFormRows(records, allocation, mode).length;

  const create = async (kind: "xlsx" | "csv") => {
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const stamp = fileTimestamp(new Date());
      let name: string;
      let blob: Blob;
      if (kind === "xlsx") {
        const res = await fetch(templateUrl);
        if (!res.ok) throw new Error("集計フォームのテンプレートを読み込めませんでした");
        const data = buildFormXlsx(new Uint8Array(await res.arrayBuffer()), buildFormRows(records, allocation, mode));
        name = `医療費集計フォーム_${year}_${stamp}.xlsx`;
        blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: XLSX_MIME });
      } else {
        name = `医療費一覧_${year}_${stamp}.csv`;
        blob = new Blob([buildCsv(records, allocation)], { type: "text/csv" });
      }
      // ドライブに保存できなくても、端末には保存できるようにする
      let fileId: string | null = null;
      let driveError: string | null = null;
      try {
        fileId = await saveOutput(name, blob);
      } catch (e) {
        driveError = e instanceof Error ? e.message : String(e);
      }
      setOutput({ name, blob, fileId, driveError });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="font-bold">出力</h2>
      {drafts > 0 && (
        <WarningText>
          一時保存の記録が {drafts}件 あります。出力には含まれません。
          <Link to="/records" className="ml-1 underline">
            記録一覧へ
          </Link>
        </WarningText>
      )}
      {excess.map((e) => (
        <WarningText key={e.entry.id}>
          {Number(e.entry.month.slice(5))}月の健保給付が対象の医療費を{formatYen(e.excess)}超えています（超えた分は差し引いていません）。領収書の入力漏れがないか確認してください。
        </WarningText>
      ))}

      <fieldset className="space-y-1 text-sm">
        <legend className="font-bold">医療費集計フォーム（Excel）の書き方</legend>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "each"} onChange={() => setMode("each")} />
          領収書1件ずつ（支払日も入れる）
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "grouped"} onChange={() => setMode("grouped")} />
          医療を受けた人・支払先ごとにまとめる
        </label>
        <p className={rowCount > FORM_MAX_ROWS ? "text-red-700" : "text-gray-500"}>
          {rowCount}行（フォームに入るのは{FORM_MAX_ROWS}行まで）
          {rowCount > FORM_MAX_ROWS && "。「人・支払先ごとにまとめる」を選んでください"}
        </p>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy || rowCount === 0 || rowCount > FORM_MAX_ROWS} onClick={() => void create("xlsx")}>
          集計フォームを作成
        </button>
        <button type="button" className={subButtonClass} disabled={busy || rowCount === 0} onClick={() => void create("csv")}>
          CSV を作成
        </button>
      </div>
      {busy && <p className="text-sm text-gray-500">作成中…</p>}
      {error && <ErrorText>{error}</ErrorText>}
      {output && (
        <NoticeText>
          <span className="block break-all">{output.name} を作成しました。</span>
          {output.fileId ? (
            <span className="block">ドライブの「{year}/出力」フォルダにも保存しました。</span>
          ) : (
            <span className="block text-red-800">ドライブには保存できませんでした: {output.driveError}</span>
          )}
          <span className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={subButtonClass} onClick={() => void saveToDevice(output.blob, output.name)}>
              端末に保存
            </button>
            {output.fileId && (
              <a href={driveFileUrl(output.fileId)} target="_blank" rel="noreferrer" className={subButtonClass}>
                ドライブで開く
              </a>
            )}
          </span>
        </NoticeText>
      )}
      <p className="text-xs text-gray-500">
        集計フォームは、国税庁の確定申告書等作成コーナーの医療費控除の入力で「医療費集計フォームを利用する」を選んで読み込みます。読み込んだ後は、画面に反映された内容を必ず確認してください。補填額は、記録ごとの補填額と健保給付の配分の合計です。
      </p>
    </section>
  );
}
