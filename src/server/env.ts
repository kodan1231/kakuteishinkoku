export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  /** OCR 検証ページ用の合言葉。未設定なら検証 API は無効 */
  OCR_LAB_KEY?: string;
}
