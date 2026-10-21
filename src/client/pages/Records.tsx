import { Link } from "react-router";
import { buttonClass, Page } from "../components/Layout";
import { useReadyLedger } from "../drive/LedgerProvider";
import { formatMonthDay, formatYen } from "../lib/format";

export function Records() {
  const { year, records } = useReadyLedger();
  return (
    <Page title={`${year}年分の記録`}>
      <Link to="/" className="text-sm text-teal-700 underline">
        ← ホーム
      </Link>
      <Link to="/records/new" className={`${buttonClass} block text-center`}>
        記録する
      </Link>
      <ul className="divide-y rounded border">
        {records.map((r) => (
          <li key={r.id}>
            <Link to={`/records/${r.id}`} className="flex items-center justify-between gap-2 p-2">
              <div className="min-w-0">
                <div className="truncate">{r.payee}</div>
                <div className="text-xs text-gray-500">
                  {formatMonthDay(r.date)}・{r.personName}・{r.category}
                  {r.receiptFileIds.length > 0 && `・領収書${r.receiptFileIds.length}`}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div>{formatYen(r.amount)}</div>
                {r.reimbursed > 0 && <div className="text-xs text-gray-500">補填 {formatYen(r.reimbursed)}</div>}
              </div>
            </Link>
          </li>
        ))}
        {records.length === 0 && <li className="p-2 text-sm text-gray-500">まだ記録がありません</li>}
      </ul>
    </Page>
  );
}
