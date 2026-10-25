import { todayString } from "../drive/records";
import { subButtonClass } from "./Layout";

const selectClass = "rounded border px-2 py-1";

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 年度内の日付を「月」「日」のプルダウンで選ぶ（iPhone ではリールで表示される）。
 * 値は YYYY-MM-DD、未入力は空文字。
 */
export function DateSelect({
  year,
  value,
  onChange,
  disabled,
}: {
  year: number;
  value: string;
  onChange: (date: string) => void;
  disabled?: boolean;
}) {
  const [, month, day] = value ? value.split("-").map(Number) : [];
  const today = todayString();
  // 月を変えて日がその月に無くなった（1/31 → 2月など）ときは月末日にする
  const emit = (m: number, d: number) => onChange(`${year}-${pad(m)}-${pad(Math.min(d, daysInMonth(year, m)))}`);
  return (
    <span className="mt-1 flex items-center gap-2">
      <select
        value={month ?? ""}
        onChange={(e) => emit(Number(e.target.value), day ?? 1)}
        className={selectClass}
        disabled={disabled}
        aria-label="月"
      >
        {!month && <option value="">月</option>}
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}月
          </option>
        ))}
      </select>
      <select
        value={day ?? ""}
        onChange={(e) => emit(month ?? 1, Number(e.target.value))}
        className={selectClass}
        disabled={disabled}
        aria-label="日"
      >
        {!day && <option value="">日</option>}
        {Array.from({ length: daysInMonth(year, month ?? 1) }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}日
          </option>
        ))}
      </select>
      {today.startsWith(`${year}-`) && (
        <button type="button" className={subButtonClass} disabled={disabled} onClick={() => onChange(today)}>
          今日
        </button>
      )}
    </span>
  );
}
