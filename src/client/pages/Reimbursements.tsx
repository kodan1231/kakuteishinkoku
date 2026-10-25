import { useState } from "react";
import { Link } from "react-router";
import { buttonClass, ErrorText, inputClass, Page, subButtonClass, WarningText } from "../components/Layout";
import { useReadyLedger, type MonthlyReimbursementInput } from "../drive/LedgerProvider";
import { AMOUNT_MAX, isFinal, parseAmount } from "../drive/records";
import { ALLOCATION_CATEGORIES, eligibleRecords, monthsOf, totalReimbursed, type MonthlyReimbursement } from "../drive/reimbursements";
import { formatYen } from "../lib/format";

/** 月ごとの補填額（健保給付）の入力と、配分の確認 */
export function Reimbursements() {
  const { year, family, records, reimbursements, allocation, saveMonthlyReimbursement } = useReadyLedger();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finals = records.filter(isFinal);
  const paid = finals.reduce((s, r) => s + r.amount, 0);
  const reimbursed = finals.reduce((s, r) => s + totalReimbursed(r, allocation), 0);

  const save = async (input: MonthlyReimbursementInput) => {
    setBusy(true);
    setError(null);
    try {
      await saveMonthlyReimbursement(input);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="健保給付・補填">
      <Link to="/" className="text-sm text-teal-700 underline">
        ← ホーム
      </Link>
      <p className="text-sm text-gray-600">
        給与明細の「健保給付」など、医療費を補填する給付を月ごとに入力すると、その月の「{ALLOCATION_CATEGORIES.join("」「")}
        」の記録に支払額の割合で配分して差し引きます。月は記録の支払日の月です。記録の支払額は変わりません。
      </p>
      <p className="text-xs text-gray-500">
        高額療養費・付加給付が対象です。傷病手当金・出産手当金は医療費の補填ではないため入力しないでください。給付の種類は健康保険組合の支給決定通知書などで確認できます。
      </p>
      {error && <ErrorText>{error}</ErrorText>}

      <section className="grid grid-cols-3 gap-2 rounded border p-3 text-center text-sm">
        <div>
          <div className="text-gray-600">支払額（調整前）</div>
          <div className="font-bold">{formatYen(paid)}</div>
        </div>
        <div>
          <div className="text-gray-600">補填</div>
          <div className="font-bold">−{formatYen(reimbursed)}</div>
        </div>
        <div>
          <div className="text-gray-600">調整後</div>
          <div className="font-bold">{formatYen(paid - reimbursed)}</div>
        </div>
      </section>

      <ul className="divide-y rounded border">
        {monthsOf(year).map((month) => {
          const entry = reimbursements.find((r) => r.month === month);
          const summary = entry ? allocation.entries.find((s) => s.entry.id === entry.id) : undefined;
          const eligible =
            summary?.eligible ??
            eligibleRecords(records, month, "").reduce((s, r) => s + Math.max(r.amount - r.reimbursed, 0), 0);
          const allocated = summary?.allocated ?? 0;
          const person = entry?.personId ? family.find((f) => f.id === entry.personId)?.name ?? "（削除済みの家族）" : null;
          return (
            <li key={month} className="space-y-2 p-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold">{Number(month.slice(5))}月</div>
                  <div className="text-xs text-gray-500">
                    対象 {formatYen(eligible)}
                    {entry && ` → 調整後 ${formatYen(eligible - allocated)}`}
                    {person && `・対象: ${person}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span>{entry ? `−${formatYen(entry.amount)}` : "—"}</span>
                  {editing !== month && (
                    <button type="button" className={subButtonClass} disabled={busy} onClick={() => setEditing(month)}>
                      {entry ? "編集" : "入力"}
                    </button>
                  )}
                </div>
              </div>
              {summary && summary.excess > 0 && (
                <WarningText>
                  対象の医療費を{formatYen(summary.excess)}超えています。超えた分は差し引けないため配分していません。
                </WarningText>
              )}
              {entry?.memo && <div className="text-xs text-gray-500">メモ: {entry.memo}</div>}
              {editing === month && (
                <MonthForm
                  month={month}
                  entry={entry}
                  family={family}
                  busy={busy}
                  onSave={(input) => void save(input)}
                  onCancel={() => setEditing(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </Page>
  );
}

function MonthForm({
  month,
  entry,
  family,
  busy,
  onSave,
  onCancel,
}: {
  month: string;
  entry?: MonthlyReimbursement;
  family: { id: string; name: string }[];
  busy: boolean;
  onSave: (input: MonthlyReimbursementInput) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [personId, setPersonId] = useState(entry?.personId ?? "");
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const parsed = amount.trim() ? parseAmount(amount) : 0;
  const invalid = parsed === null || parsed > AMOUNT_MAX;
  return (
    <div className="space-y-2 rounded bg-gray-50 p-2">
      <label className="block text-sm">
        補填額（円・健保給付）
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} disabled={busy} />
      </label>
      {invalid && <p className="text-sm text-red-700">金額を整数で入力してください</p>}
      <label className="block text-sm">
        対象の人
        <select value={personId} onChange={(e) => setPersonId(e.target.value)} className={inputClass} disabled={busy}>
          <option value="">家族全員</option>
          {family.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        メモ（例: 3月給与で支給）
        <input value={memo} onChange={(e) => setMemo(e.target.value)} className={inputClass} disabled={busy} />
      </label>
      <p className="text-xs text-gray-500">金額を空欄（0）にして保存すると、この月の補填を削除します。</p>
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy || invalid}
          onClick={() => onSave({ id: entry?.id, month, personId, amount: parsed ?? 0, memo })}
        >
          保存
        </button>
        <button type="button" className={subButtonClass} disabled={busy} onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
