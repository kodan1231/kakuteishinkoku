import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { MEDICAL_CATEGORIES } from "../../shared/medical";
import { inputClass, Page, subButtonClass } from "../components/Layout";
import { StartRecord } from "../components/StartRecord";
import { useReadyLedger } from "../drive/LedgerProvider";
import {
  applyFilter,
  EMPTY_FILTER,
  filterFromParams,
  filterToParams,
  groupByMonth,
  hasCondition,
  rememberRecordsSearch,
  type RecordFilter,
} from "../drive/recordFilter";
import { isFinal, type MedicalRecord } from "../drive/records";
import { adjustedAmount, totalReimbursed, type Allocation } from "../drive/reimbursements";
import { formatMonthDay, formatYen } from "../lib/format";

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1));

export function Records() {
  const { year, records, allocation } = useReadyLedger();
  const [params, setParams] = useSearchParams();
  const filter = filterFromParams(params);
  const search = params.toString();
  useEffect(() => rememberRecordsSearch(search), [search]);

  const drafts = records.filter((r) => !isFinal(r));
  const finals = records.filter(isFinal);
  const shown = applyFilter(finals, filter);
  const filtered = hasCondition(filter);
  const update = (patch: Partial<RecordFilter>) => setParams(filterToParams({ ...filter, ...patch }), { replace: true });

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

      <section className="space-y-2">
        {drafts.length > 0 && <h2 className="text-sm font-bold">保存済み</h2>}
        <FilterForm filter={filter} onChange={update} />
        {filtered && (
          <div className="flex items-start justify-between gap-2 rounded bg-gray-50 p-2 text-sm">
            <Totals records={shown} allocation={allocation} />
            <button type="button" className={`${subButtonClass} shrink-0`} onClick={() => update({ ...EMPTY_FILTER, sort: filter.sort })}>
              条件をクリア
            </button>
          </div>
        )}
        {filter.sort === "amount" ? (
          <RecordList records={shown} empty={finals.length === 0 ? "まだ記録がありません" : "条件に合う記録がありません"} />
        ) : (
          <>
            {groupByMonth(shown).map((g) => (
              <div key={g.month} className="space-y-1">
                <h3 className="flex justify-between text-sm font-bold text-gray-700">
                  <span>{Number(g.month.slice(5))}月</span>
                  <span className="font-normal">
                    {g.records.length}件・{formatYen(g.records.reduce((s, r) => s + r.amount, 0))}
                  </span>
                </h3>
                <RecordList records={g.records} />
              </div>
            ))}
            {shown.length === 0 && (
              <p className="rounded border p-2 text-sm text-gray-500">
                {finals.length === 0 ? "まだ記録がありません" : "条件に合う記録がありません"}
              </p>
            )}
          </>
        )}
      </section>
    </Page>
  );
}

function FilterForm({ filter, onChange }: { filter: RecordFilter; onChange: (patch: Partial<RecordFilter>) => void }) {
  const { family, records } = useReadyLedger();
  const detailCount = [filter.personId, filter.category, filter.fromMonth || filter.toMonth, filter.min || filter.max, filter.noReceipt].filter(
    Boolean,
  ).length;
  const [open, setOpen] = useState(detailCount > 0);
  // 家族を削除しても、記録に残っている人で絞り込めるようにする
  const persons = [
    ...family.map((f) => ({ id: f.id, name: f.name })),
    ...[...new Map(records.filter((r) => !family.some((f) => f.id === r.personId)).map((r) => [r.personId, r.personName]))].map(
      ([id, name]) => ({ id, name: `${name}（削除済み）` }),
    ),
  ];
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="search"
          value={filter.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="支払先・メモで探す"
          className={`${inputClass} mt-0 min-w-0 flex-1`}
        />
        <button type="button" className={`${subButtonClass} shrink-0`} onClick={() => setOpen(!open)}>
          絞り込み{detailCount > 0 && `（${detailCount}）`} {open ? "▲" : "▼"}
        </button>
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-2 rounded border p-2 text-sm">
          <label>
            医療を受けた人
            <select value={filter.personId} onChange={(e) => onChange({ personId: e.target.value })} className={inputClass}>
              <option value="">すべて</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            区分
            <select value={filter.category} onChange={(e) => onChange({ category: e.target.value })} className={inputClass}>
              <option value="">すべて</option>
              {MEDICAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="col-span-2">
            期間
            <div className="flex items-center gap-1">
              <MonthSelect value={filter.fromMonth} onChange={(fromMonth) => onChange({ fromMonth })} />
              〜
              <MonthSelect value={filter.toMonth} onChange={(toMonth) => onChange({ toMonth })} />
            </div>
          </div>
          <div className="col-span-2">
            支払額
            <div className="flex items-center gap-1">
              <input inputMode="numeric" value={filter.min} onChange={(e) => onChange({ min: e.target.value })} placeholder="下限" className={inputClass} />
              〜
              <input inputMode="numeric" value={filter.max} onChange={(e) => onChange({ max: e.target.value })} placeholder="上限" className={inputClass} />
              円
            </div>
          </div>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={filter.noReceipt} onChange={(e) => onChange({ noReceipt: e.target.checked })} />
            領収書が添付されていない記録だけ
          </label>
          <label className="col-span-2">
            並び順
            <select value={filter.sort} onChange={(e) => onChange({ sort: e.target.value as RecordFilter["sort"] })} className={inputClass}>
              <option value="new">日付の新しい順</option>
              <option value="old">日付の古い順</option>
              <option value="amount">金額の大きい順</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function MonthSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} mt-0`}>
      <option value="">指定なし</option>
      {MONTHS.map((m) => (
        <option key={m} value={m}>
          {m}月
        </option>
      ))}
    </select>
  );
}

function Totals({ records, allocation }: { records: MedicalRecord[]; allocation: Allocation }) {
  const paid = records.reduce((s, r) => s + r.amount, 0);
  const reimbursed = records.reduce((s, r) => s + totalReimbursed(r, allocation), 0);
  return (
    <div>
      <div className="font-bold">
        {records.length}件・調整後 {formatYen(paid - reimbursed)}
      </div>
      <div className="text-xs text-gray-600">
        支払額 {formatYen(paid)}
        {reimbursed > 0 && ` − 補填 ${formatYen(reimbursed)}`}
      </div>
    </div>
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
