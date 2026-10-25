import { Link } from "react-router";
import { Page } from "../components/Layout";
import { StartRecord } from "../components/StartRecord";
import { useReadyLedger } from "../drive/LedgerProvider";
import { isFinal, type MedicalRecord } from "../drive/records";
import { adjustedAmount, totalReimbursed } from "../drive/reimbursements";
import { formatMonthDay, formatYen } from "../lib/format";

export function Records() {
  const { year, records } = useReadyLedger();
  const drafts = records.filter((r) => !isFinal(r));
  const finals = records.filter(isFinal);
  return (
    <Page title={`${year}年分の記録`}>
      <Link to="/" className="text-sm text-teal-700 underline">
        ← ホーム
      </Link>
      <StartRecord />

      {drafts.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-bold text-amber-900">一時保存（入力途中・合計には含まれません）</h2>
          <RecordList records={drafts} />
        </section>
      )}

      <section className="space-y-1">
        {drafts.length > 0 && <h2 className="text-sm font-bold">保存済み</h2>}
        <RecordList records={finals} empty="まだ記録がありません" />
      </section>
    </Page>
  );
}

function RecordList({ records, empty }: { records: MedicalRecord[]; empty?: string }) {
  const { allocation } = useReadyLedger();
  return (
    <ul className="divide-y rounded border">
      {records.map((r) => (
        <li key={r.id}>
          <Link to={`/records/${r.id}`} className="flex items-center justify-between gap-2 p-2">
            <div className="min-w-0">
              <div className="truncate">{r.payee || "（支払先未入力）"}</div>
              <div className="text-xs text-gray-500">
                {r.date ? formatMonthDay(r.date) : "日付未入力"}・{r.personName}・{r.category}
                {r.receiptFileIds.length > 0 && `・領収書${r.receiptFileIds.length}`}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div>{r.amount > 0 ? formatYen(r.amount) : "—"}</div>
              {totalReimbursed(r, allocation) > 0 && (
                <div className="text-xs text-gray-500">
                  補填 {formatYen(totalReimbursed(r, allocation))} → {formatYen(adjustedAmount(r, allocation))}
                </div>
              )}
            </div>
          </Link>
        </li>
      ))}
      {records.length === 0 && empty && <li className="p-2 text-sm text-gray-500">{empty}</li>}
    </ul>
  );
}
