/** 還付申告は過去5年分まで提出できるため、今年を含め6年分を選べるようにする */
const SELECTABLE_PAST_YEARS = 5;

/** その年分の申告期限（翌年3月15日。土日なら翌月曜）の日付 */
export function filingDeadline(taxYear: number): Date {
  const d = new Date(taxYear + 1, 2, 15);
  const dow = d.getDay();
  if (dow === 6) d.setDate(17);
  if (dow === 0) d.setDate(16);
  return d;
}

/** 初期表示する年度。1月1日〜申告期限は前年分、それ以降は今年分 */
export function defaultTaxYear(now: Date): number {
  const year = now.getFullYear();
  const today = new Date(year, now.getMonth(), now.getDate());
  return today <= filingDeadline(year - 1) ? year - 1 : year;
}

/** 選択できる年度（新しい順） */
export function selectableYears(now: Date): number[] {
  const year = now.getFullYear();
  return Array.from({ length: SELECTABLE_PAST_YEARS + 1 }, (_, i) => year - i);
}
