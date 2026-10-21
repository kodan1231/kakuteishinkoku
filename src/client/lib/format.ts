export function formatYen(n: number): string {
  return `${n.toLocaleString("ja-JP")}円`;
}

/** YYYY-MM-DD → 1月15日 */
export function formatMonthDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return m && d ? `${m}月${d}日` : date;
}
