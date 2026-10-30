import type { AppUser } from "../shared/auth";

export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** 招待なしで管理者として登録できる Google アカウント */
  ADMIN_EMAIL: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { user: AppUser };
}
