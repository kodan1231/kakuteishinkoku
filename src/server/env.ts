import type { AppUser } from "../shared/auth";

export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** 招待なしで管理者として登録できる Google アカウント */
  ADMIN_EMAIL: string;
  /** OCR 検証ページ用の合言葉。未設定なら検証 API は無効 */
  OCR_LAB_KEY?: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { user: AppUser };
}
