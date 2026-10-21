export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";

export interface AppUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
}

/** Google の OAuth スコープ（drive.file はアプリが作成したファイルのみ扱える） */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
] as const;

export interface AppConfig {
  googleClientId: string;
}

export interface TokenExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  inviteToken?: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface TokenResponse {
  accessToken: string;
  idToken: string;
  /** 初回ログイン時のみ。更新時は Google が返した場合のみ（通常は返さない） */
  refreshToken?: string;
  /** アクセストークン・ID トークンの有効期限（epoch ミリ秒） */
  expiresAt: number;
  user: AppUser;
}

export interface InviteStatus {
  valid: boolean;
  expiresAt?: number;
}

export interface InvitationSummary {
  id: string;
  memo: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedByEmail: string | null;
  revokedAt: number | null;
}

export interface CreatedInvitation extends InvitationSummary {
  /** 平文の招待トークン。作成時に一度だけ返す */
  token: string;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  lastSeenAt: number | null;
}

export const INVITE_DEFAULT_DAYS = 7;
export const INVITE_MAX_DAYS = 30;
