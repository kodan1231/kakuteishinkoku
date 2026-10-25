import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { MEDICAL_CATEGORIES } from "../../shared/medical";
import type { ReceiptFields } from "../../shared/ocr";
import { DateSelect } from "../components/DateSelect";
import { buttonClass, ErrorText, inputClass, NoticeText, Page, subButtonClass, WarningText } from "../components/Layout";
import { LocalFilePreview, ReceiptPreview } from "../components/ReceiptPreview";
import type { FamilyMember } from "../drive/ledger";
import { useReadyLedger } from "../drive/LedgerProvider";
import {
  emptyTransport,
  findLinkedTransport,
  inputFromPrevious,
  isFinal,
  isTransportRecord,
  lastCategoryFor,
  lastVisitTo,
  PAYEE_MAX_LENGTH,
  payeeSuggestions,
  todayString,
  transportAmount,
  transportFromRecord,
  validateDraft,
  validateRecord,
  validateTransport,
  type MedicalRecord,
  type RecordInput,
  type TransportInput,
} from "../drive/records";
import { formatYen } from "../lib/format";
import { clearHandedOffPhoto, peekHandedOffPhoto, useOcr } from "../lib/ocr";

/** 交通費を一緒に入力できる区分 */
const VISIT_CATEGORY = "診療・治療";
const RECENT_PAYEES = 5;
/** 読み取りに自信がないときに目立たせる */
const uncertainClass = " ring-2 ring-amber-400";

export function RecordEdit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { records } = useReadyLedger();
  const existing = id ? records.find((r) => r.id === id) : undefined;
  if (id && !existing) {
    return (
      <Page title="記録">
        <ErrorText>記録が見つかりません。削除されたか、別の年度の記録です。</ErrorText>
        <Link to="/records" className="text-sm text-teal-700 underline">
          ← 記録一覧
        </Link>
      </Page>
    );
  }
  const from = params.get("from");
  const template = from ? records.find((r) => r.id === from) : undefined;
  const withPhoto = !id && params.has("photo");
  return (
    <RecordForm
      key={id ?? `new-${from ?? ""}-${withPhoto}`}
      existing={existing}
      template={template}
      withPhoto={withPhoto}
    />
  );
}

interface FormState {
  input: RecordInput;
  /** 交通費を一緒に記録するか */
  withTransport: boolean;
  transport: TransportInput;
}

interface OcrState {
  status: "reading" | "done" | "failed";
  message?: string;
  candidates: string[];
  /** 読み取りに自信がなく、まだ利用者が触っていない項目 */
  uncertain: (keyof RecordInput)[];
  warnings: string[];
}

function RecordForm({
  existing,
  template,
  withPhoto,
}: {
  existing?: MedicalRecord;
  template?: MedicalRecord;
  withPhoto: boolean;
}) {
  const navigate = useNavigate();
  const { year, family, records, saveRecord, deleteRecord } = useReadyLedger();
  const { read } = useOcr();
  const [photo] = useState(() => (withPhoto ? peekHandedOffPhoto() : null));
  const [form, setForm] = useState<FormState>(() => initialForm(existing, template, year, family, records));
  const [newFiles, setNewFiles] = useState<File[]>(() => (photo ? [photo] : []));
  const [removed, setRemoved] = useState<string[]>([]);
  const [ocr, setOcr] = useState<OcrState | null>(() =>
    photo ? { status: "reading", candidates: [], uncertain: [], warnings: [] } : null,
  );
  const [submitted, setSubmitted] = useState<"final" | "draft" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ocrStarted = useRef(false);

  // 写真を読み取って入力欄に入れる（StrictMode でも読み取りは1回だけ）
  useEffect(() => {
    clearHandedOffPhoto();
    if (!photo || ocrStarted.current) return;
    ocrStarted.current = true;
    read(photo).then(
      (res) => {
        if (!res.fields) {
          setOcr({ status: "failed", message: "読み取れませんでした。手入力してください", candidates: [], uncertain: [], warnings: [] });
          return;
        }
        const applied = applyOcr(res.fields, year, records);
        setForm((f) => ({
          input: { ...f.input, ...applied.input },
          withTransport: applied.transport ? true : f.withTransport,
          transport: applied.transport ?? f.transport,
        }));
        setOcr({ status: "done", candidates: res.fields.payeeCandidates, uncertain: applied.uncertain, warnings: applied.warnings });
      },
      (e: unknown) =>
        setOcr({ status: "failed", message: e instanceof Error ? e.message : String(e), candidates: [], uncertain: [], warnings: [] }),
    );
  }, [photo, read, year, records]);

  const reading = ocr?.status === "reading";
  const locked = busy || reading;
  const v = form.input;
  const isDraft = existing?.status === "draft";
  const linkedTransport = existing && !isDraft ? findLinkedTransport(records, existing) : null;
  // 交通費の記録そのものの編集中や、すでに交通費がある診療では出さない
  const transportAvailable = v.category === VISIT_CATEGORY && !linkedTransport && !(existing && isTransportRecord(existing));
  const transportOn = transportAvailable && form.withTransport;
  const errors = submitted === "draft" ? validateDraft(v, year) : validateRecord(v, year);
  const tErrors = transportOn && submitted !== "draft" ? validateTransport(form.transport) : {};
  const hasErrors = Object.keys(errors).length + Object.keys(tErrors).length > 0;
  const shown = submitted ? errors : {};
  const tShown = submitted ? tErrors : {};
  const hl = (field: keyof RecordInput) => (ocr?.uncertain.includes(field) ? uncertainClass : "");

  const set = (patch: Partial<RecordInput>) => {
    setForm((f) => ({ ...f, input: { ...f.input, ...patch } }));
    // 触った項目は目立たせるのをやめる
    setOcr((o) => (o ? { ...o, uncertain: o.uncertain.filter((k) => !(k in patch)) } : o));
  };
  const setT = (patch: Partial<TransportInput>) => setForm((f) => ({ ...f, transport: { ...f.transport, ...patch } }));

  /** 支払先を決めたとき、前回の区分と交通費を入れる（新規・一時保存のみ） */
  const choosePayee = (payee: string) => {
    if (existing && !isDraft) {
      set({ payee });
      return;
    }
    const category = lastCategoryFor(records, payee);
    set(category ? { payee, category } : { payee });
    const prev = lastVisitTo(records, payee);
    const linked = prev ? findLinkedTransport(records, prev) : null;
    const transport = linked ? transportFromRecord(linked) : null;
    if (transport) setForm((f) => (f.withTransport ? f : { ...f, withTransport: true, transport }));
  };

  const persons: Pick<FamilyMember, "id" | "name">[] =
    family.some((f) => f.id === v.personId) || !existing
      ? family
      : [...family, { id: existing.personId, name: `${existing.personName}（削除済み）` }];
  const carriers = payeeSuggestions(records.filter(isTransportRecord));

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      navigate("/records");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const save = (mode: "final" | "draft") => {
    setSubmitted(mode);
    const errs = mode === "draft" ? validateDraft(v, year) : validateRecord(v, year);
    const tErrs = mode === "final" && transportOn ? validateTransport(form.transport) : {};
    if (Object.keys(errs).length + Object.keys(tErrs).length > 0) return;
    void run(() =>
      saveRecord(v, {
        id: existing?.id,
        newFiles,
        removedFileIds: removed,
        transport: mode === "final" && transportOn ? form.transport : undefined,
        draft: mode === "draft",
        source: photo ? "ocr" : undefined,
      }),
    );
  };

  return (
    <Page title={isDraft ? "一時保存の記録" : existing ? "記録の編集" : "記録する"}>
      <Link to="/records" className="text-sm text-teal-700 underline">
        ← 記録一覧
      </Link>
      {error && <ErrorText>{error}</ErrorText>}
      {reading && <NoticeText>写真を読み取っています…（数秒かかります）</NoticeText>}
      {ocr?.status === "failed" && <WarningText>{ocr.message}</WarningText>}
      {ocr?.status === "done" && (
        <NoticeText>
          写真から読み取りました。内容を確認してください。
          {ocr.uncertain.length > 0 && "枠が黄色の項目は読み取りに自信がありません。"}
        </NoticeText>
      )}
      {ocr?.warnings.map((w) => (
        <WarningText key={w}>{w}</WarningText>
      ))}

      {!existing && !photo && (
        <RecentPayees
          records={records}
          disabled={locked}
          onPick={(prev) => setForm(fromPrevious(prev, v.date, family, records))}
        />
      )}

      <Field label="支払日" error={shown.date}>
        <span className={`block rounded${hl("date")}`}>
          <DateSelect year={year} value={v.date} onChange={(date) => set({ date })} disabled={locked} />
        </span>
      </Field>

      <Field label="医療を受けた人" error={shown.personId}>
        <select value={v.personId} onChange={(e) => set({ personId: e.target.value })} className={inputClass} disabled={locked}>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      {ocr && ocr.candidates.length > 1 && (
        <section className="space-y-1">
          <div className="text-sm text-gray-600">支払先の候補（領収書から読み取り）</div>
          <div className="flex flex-wrap gap-2">
            {ocr.candidates.map((p) => (
              <button
                key={p}
                type="button"
                className={`${subButtonClass}${v.payee === p ? " border-teal-700 bg-teal-50" : ""}`}
                disabled={locked}
                onClick={() => choosePayee(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </section>
      )}

      <Field label={`支払先（病院・薬局など、${PAYEE_MAX_LENGTH}文字以内）`} error={shown.payee}>
        <input
          value={v.payee}
          list="payee-suggestions"
          onChange={(e) => choosePayee(e.target.value)}
          className={inputClass + hl("payee")}
          disabled={locked}
        />
        <datalist id="payee-suggestions">
          {payeeSuggestions(records).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <Field label="区分" error={shown.category}>
        <select value={v.category} onChange={(e) => set({ category: e.target.value })} className={inputClass} disabled={locked}>
          {MEDICAL_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>

      <Field label="支払額（円）" error={shown.amount}>
        <input
          inputMode="numeric"
          value={v.amount}
          onChange={(e) => set({ amount: e.target.value })}
          className={inputClass + hl("amount")}
          disabled={locked}
        />
      </Field>

      <Field label="補填額（円・保険金などで補填される額）" error={shown.reimbursed}>
        <input
          inputMode="numeric"
          value={v.reimbursed}
          placeholder="0"
          onChange={(e) => set({ reimbursed: e.target.value })}
          className={inputClass}
          disabled={locked}
        />
      </Field>

      <Field label="メモ" error={shown.memo}>
        <textarea value={v.memo} onChange={(e) => set({ memo: e.target.value })} rows={2} className={inputClass} disabled={locked} />
      </Field>

      {linkedTransport && (
        <p className="text-sm">
          同じ日の交通費: {linkedTransport.payee} {formatYen(linkedTransport.amount)}{" "}
          <Link to={`/records/${linkedTransport.id}`} className="text-teal-700 underline">
            編集
          </Link>
        </p>
      )}
      {transportAvailable && (
        <TransportFields
          on={form.withTransport}
          onToggle={(on) =>
            setForm((f) => ({
              ...f,
              withTransport: on,
              // 到着地が空なら支払先（病院）を入れておく
              transport: on && !f.transport.to.trim() ? { ...f.transport, to: f.input.payee.trim() } : f.transport,
            }))
          }
          value={form.transport}
          onChange={setT}
          errors={tShown}
          carriers={carriers}
          disabled={locked}
          note={isDraft || !existing ? "交通費は「保存」したときに記録されます（一時保存では記録されません）" : undefined}
        />
      )}

      <section className="space-y-2">
        <div className="text-sm">領収書（写真・PDF）</div>
        <div className="flex flex-wrap gap-2">
          {existing?.receiptFileIds.map((id) => (
            <div key={id} className={removed.includes(id) ? "opacity-40" : ""}>
              <ReceiptPreview fileId={id}>
                <button
                  type="button"
                  className="text-xs text-teal-700 underline"
                  disabled={locked}
                  onClick={() => setRemoved((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
                >
                  {removed.includes(id) ? "元に戻す" : "削除"}
                </button>
              </ReceiptPreview>
            </div>
          ))}
          {newFiles.map((f, i) => (
            <div key={`${f.name}-${i}`} className="space-y-1 text-center">
              <LocalFilePreview file={f} />
              <button
                type="button"
                className="text-xs text-teal-700 underline"
                disabled={locked}
                onClick={() => setNewFiles((cur) => cur.filter((_, j) => j !== i))}
              >
                取り消し
              </button>
            </div>
          ))}
        </div>
        <label className={`${subButtonClass} inline-block cursor-pointer`}>
          写真・PDF を追加
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            disabled={locked}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              setNewFiles((cur) => [...cur, ...files]);
              e.target.value = "";
            }}
          />
        </label>
      </section>

      {submitted && hasErrors && <ErrorText>入力内容を確認してください</ErrorText>}
      <div className="flex flex-col gap-2">
        <button type="button" className={buttonClass} disabled={locked} onClick={() => save("final")}>
          {busy ? "保存しています…" : transportOn ? "保存（交通費も記録）" : "保存"}
        </button>
        {(!existing || isDraft) && (
          <button type="button" className={subButtonClass} disabled={locked} onClick={() => save("draft")}>
            一時保存（あとで続きを入力）
          </button>
        )}
        {existing && !isDraft && (
          <button type="button" className={subButtonClass} disabled={locked} onClick={() => navigate(`/records/new?from=${existing.id}`)}>
            この内容で新しく記録
          </button>
        )}
        {existing && (
          <button
            type="button"
            className={subButtonClass}
            disabled={locked}
            onClick={() => {
              if (confirm("この記録を削除しますか？（領収書はドライブのゴミ箱に移ります）")) void run(() => deleteRecord(existing.id));
            }}
          >
            削除
          </button>
        )}
      </div>
    </Page>
  );
}

/** 読み取り結果を入力欄の値にする。年度の違う日付は入れずに警告を出す */
function applyOcr(
  fields: ReceiptFields,
  year: number,
  records: MedicalRecord[],
): { input: Partial<RecordInput>; transport: TransportInput | null; uncertain: (keyof RecordInput)[]; warnings: string[] } {
  const input: Partial<RecordInput> = {};
  const warnings: string[] = [];
  if (fields.date?.startsWith(`${year}-`)) {
    input.date = fields.date;
  } else if (fields.date) {
    // 初期値の「今日」のまま保存されないよう空欄にする
    input.date = "";
    const [y, m, d] = fields.date.split("-").map(Number);
    warnings.push(`読み取った日付は${y}年${m}月${d}日です。${y}年分の記録なら、設定で年度を切り替えてから記録してください。`);
  }
  if (fields.payee) input.payee = fields.payee;
  if (fields.amount !== null && fields.amount > 0) input.amount = String(fields.amount);
  if (fields.category && (MEDICAL_CATEGORIES as readonly string[]).includes(fields.category)) {
    input.category = fields.category;
  } else if (fields.category === "医療費以外") {
    warnings.push("医療費以外の支払いの可能性があります。医療費控除の対象か確認してください。");
  }
  // 前回と同じ支払先なら、前回の区分と交通費を使う
  const prev = fields.payee ? lastVisitTo(records, fields.payee) : null;
  if (prev && !input.category) input.category = prev.category;
  const linked = prev ? findLinkedTransport(records, prev) : null;
  const transport = linked ? transportFromRecord(linked) : null;
  const uncertain = fields.uncertain.filter((f) => f !== "date" || input.date) as (keyof RecordInput)[];
  return { input, transport, uncertain, warnings };
}

function RecentPayees({
  records,
  disabled,
  onPick,
}: {
  records: MedicalRecord[];
  disabled: boolean;
  onPick: (prev: MedicalRecord) => void;
}) {
  const visits = records.filter((r) => isFinal(r) && !isTransportRecord(r));
  const payees = payeeSuggestions(visits).slice(0, RECENT_PAYEES);
  if (payees.length === 0) return null;
  return (
    <section className="space-y-1">
      <div className="text-sm text-gray-600">最近の支払先（前回の内容を入れます）</div>
      <div className="flex flex-wrap gap-2">
        {payees.map((p) => (
          <button
            key={p}
            type="button"
            className={subButtonClass}
            disabled={disabled}
            onClick={() => {
              const prev = lastVisitTo(records, p);
              if (prev) onPick(prev);
            }}
          >
            {p}
          </button>
        ))}
      </div>
    </section>
  );
}

function TransportFields({
  on,
  onToggle,
  value,
  onChange,
  errors,
  carriers,
  disabled,
  note,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  value: TransportInput;
  onChange: (patch: Partial<TransportInput>) => void;
  errors: Partial<Record<keyof TransportInput, string>>;
  carriers: string[];
  disabled: boolean;
  note?: string;
}) {
  const amount = transportAmount(value);
  return (
    <section className="space-y-2 rounded border p-2">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} disabled={disabled} />
        通院の交通費も記録する
      </label>
      {on && (
        <>
          <p className="text-xs text-gray-500">
            交通費は別の記録（区分「その他の医療費」）として保存されます。対象は電車・バスなどの公共交通機関です。タクシーはやむを得ない場合のみ、自家用車のガソリン代・駐車場代は対象外です。付き添いが必要な場合は付添人の分も対象です。
            {note && ` ${note}`}
          </p>
          <Field label={`交通機関（${PAYEE_MAX_LENGTH}文字以内、例: JR、都営バス）`} error={errors.carrier}>
            <input
              value={value.carrier}
              list="carrier-suggestions"
              onChange={(e) => onChange({ carrier: e.target.value })}
              className={inputClass}
              disabled={disabled}
            />
            <datalist id="carrier-suggestions">
              {carriers.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <div className="flex items-end gap-2">
            <Field label="出発" error={errors.from}>
              <input value={value.from} onChange={(e) => onChange({ from: e.target.value })} className={inputClass} disabled={disabled} />
            </Field>
            <span className="pb-2">→</span>
            <Field label="到着" error={errors.to}>
              <input value={value.to} onChange={(e) => onChange({ to: e.target.value })} className={inputClass} disabled={disabled} />
            </Field>
          </div>
          <div className="flex items-end gap-4">
            <Field label="片道の運賃（円）" error={errors.fare}>
              <input
                inputMode="numeric"
                value={value.fare}
                onChange={(e) => onChange({ fare: e.target.value })}
                className={inputClass}
                disabled={disabled}
              />
            </Field>
            <label className="flex items-center gap-1 pb-2 text-sm">
              <input
                type="checkbox"
                checked={value.roundTrip}
                onChange={(e) => onChange({ roundTrip: e.target.checked })}
                disabled={disabled}
              />
              往復
            </label>
          </div>
          {amount !== null && amount > 0 && <p className="text-sm">交通費: {formatYen(amount)}</p>}
        </>
      )}
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      {label}
      {children}
      {error && <span className="mt-1 block text-red-700">{error}</span>}
    </label>
  );
}

function defaultDate(year: number): string {
  const today = todayString();
  // 選択中の年度が今年でなければ、日付は選んでもらう
  return today.startsWith(`${year}-`) ? today : "";
}

function selfId(family: FamilyMember[]): string {
  return (family.find((f) => f.relationship === "本人") ?? family[0])?.id ?? "";
}

/** 前回の記録（と、一緒に記録した交通費）から入力欄を作る */
function fromPrevious(prev: MedicalRecord, date: string, family: FamilyMember[], records: MedicalRecord[]): FormState {
  const input = inputFromPrevious(prev, date);
  if (!family.some((f) => f.id === input.personId)) input.personId = selfId(family);
  const linked = findLinkedTransport(records, prev);
  const transport = linked ? transportFromRecord(linked) : null;
  return { input, withTransport: !!transport, transport: transport ?? emptyTransport() };
}

function initialForm(
  existing: MedicalRecord | undefined,
  template: MedicalRecord | undefined,
  year: number,
  family: FamilyMember[],
  records: MedicalRecord[],
): FormState {
  if (existing) {
    const draft = existing.status === "draft";
    // 一時保存の記録は、前回と同じ支払先なら交通費を入れておく（一時保存では交通費は保存しないため）
    const prev = draft && existing.payee ? lastVisitTo(records, existing.payee) : null;
    const linked = prev ? findLinkedTransport(records, prev) : null;
    const transport = linked ? transportFromRecord(linked) : null;
    return {
      input: {
        date: existing.date,
        personId: existing.personId,
        payee: existing.payee,
        category: existing.category,
        amount: draft && existing.amount === 0 ? "" : String(existing.amount),
        reimbursed: existing.reimbursed ? String(existing.reimbursed) : "",
        memo: existing.memo,
      },
      withTransport: !!transport,
      transport: transport ?? emptyTransport(),
    };
  }
  if (template) return fromPrevious(template, defaultDate(year), family, records);
  return {
    input: {
      date: defaultDate(year),
      personId: selfId(family),
      payee: "",
      category: MEDICAL_CATEGORIES[0],
      amount: "",
      reimbursed: "",
      memo: "",
    },
    withTransport: false,
    transport: emptyTransport(),
  };
}
