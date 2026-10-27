/**
 * 端末から Google Drive / Sheets API を直接呼ぶクライアント。
 * drive.file スコープのため、本アプリが作成したファイルだけが見える。
 */

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const FILE_FIELDS = "id,name,createdTime,parents,appProperties";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

export interface DriveFile {
  id: string;
  name: string;
  createdTime?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

export interface NewDriveFile {
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties: Record<string, string>;
}

export type CellValue = string | number | boolean;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

export class GoogleClient {
  constructor(private readonly getToken: () => Promise<string>) {}

  /** appProperties がすべて一致するファイルを作成日の古い順に返す（ゴミ箱は除く） */
  async findFiles(props: Record<string, string>): Promise<DriveFile[]> {
    const conditions = Object.entries(props).map(([k, v]) => `appProperties has { key='${k}' and value='${v}' }`);
    const params = new URLSearchParams({
      q: [...conditions, "trashed = false"].join(" and "),
      orderBy: "createdTime",
      fields: `files(${FILE_FIELDS})`,
      spaces: "drive",
      pageSize: "100",
    });
    const res = await this.request<{ files?: DriveFile[] }>(`${DRIVE_FILES}?${params}`);
    return res.files ?? [];
  }

  createFile(file: NewDriveFile): Promise<DriveFile> {
    return this.request<DriveFile>(`${DRIVE_FILES}?fields=${FILE_FIELDS}`, { method: "POST", body: JSON.stringify(file) });
  }

  /** メタデータと中身を1回のリクエストでアップロードする */
  uploadFile(file: NewDriveFile, content: Blob): Promise<DriveFile> {
    const boundary = `----kakuteishinkoku${crypto.randomUUID()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(file)}\r\n`,
      `--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ]);
    return this.request<DriveFile>(`${DRIVE_UPLOAD}?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  /** 既存ファイルの中身を置き換える */
  async updateFileContent(id: string, content: Blob, mimeType: string): Promise<void> {
    await this.request(`${DRIVE_UPLOAD}/${id}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": mimeType },
      body: content,
    });
  }

  getFileMeta(id: string): Promise<{ id: string; name: string; mimeType: string }> {
    return this.request(`${DRIVE_FILES}/${id}?fields=id,name,mimeType`);
  }

  async renameFile(id: string, name: string): Promise<void> {
    await this.request(`${DRIVE_FILES}/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
  }

  /** ファイルの中身（領収書の表示用） */
  async downloadFile(id: string): Promise<Blob> {
    const res = await fetch(`${DRIVE_FILES}/${id}?alt=media`, {
      headers: { Authorization: `Bearer ${await this.getToken()}` },
    });
    if (!res.ok) throw toGoogleApiError(res.status, (await res.json().catch(() => ({}))) as GoogleErrorBody);
    return res.blob();
  }

  /** ファイルが存在し、ゴミ箱に入っていないか */
  async isAlive(id: string): Promise<boolean> {
    try {
      const res = await this.request<{ trashed?: boolean }>(`${DRIVE_FILES}/${id}?fields=trashed`);
      return !res.trashed;
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 404) return false;
      throw e;
    }
  }

  async trashFile(id: string): Promise<void> {
    await this.request(`${DRIVE_FILES}/${id}`, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
  }

  async getSheetIds(spreadsheetId: string): Promise<number[]> {
    const res = await this.request<{ sheets?: { properties: { sheetId: number } }[] }>(
      `${SHEETS}/${spreadsheetId}?fields=sheets.properties.sheetId`,
    );
    return (res.sheets ?? []).map((s) => s.properties.sheetId);
  }

  async batchUpdate(spreadsheetId: string, requests: object[]): Promise<void> {
    await this.request(`${SHEETS}/${spreadsheetId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
  }

  /** 範囲ごとの値（空の範囲は空配列）。真偽値・数値は書式なしの値で返る */
  async batchGetValues(spreadsheetId: string, ranges: string[]): Promise<unknown[][][]> {
    const params = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE" });
    for (const r of ranges) params.append("ranges", r);
    const res = await this.request<{ valueRanges?: { values?: unknown[][] }[] }>(
      `${SHEETS}/${spreadsheetId}/values:batchGet?${params}`,
    );
    return ranges.map((_, i) => res.valueRanges?.[i]?.values ?? []);
  }

  async updateValues(spreadsheetId: string, data: { range: string; values: CellValue[][] }[]): Promise<void> {
    await this.request(`${SHEETS}/${spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    });
  }

  async appendValues(spreadsheetId: string, range: string, values: CellValue[][]): Promise<void> {
    const params = new URLSearchParams({ valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" });
    await this.request(`${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?${params}`, {
      method: "POST",
      body: JSON.stringify({ values }),
    });
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await this.getToken()}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(url, { ...init, headers });
    const body = (await res.json().catch(() => ({}))) as GoogleErrorBody;
    if (!res.ok) throw toGoogleApiError(res.status, body);
    return body as T;
  }
}

interface GoogleErrorBody {
  error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] };
}

export function toGoogleApiError(status: number, body: GoogleErrorBody): GoogleApiError {
  const err = body.error ?? {};
  const reason = err.errors?.[0]?.reason ?? err.details?.find((d) => d.reason)?.reason;
  // Google の同意画面でドライブへのアクセスのチェックを外した場合
  if (status === 403 && (reason === "insufficientPermissions" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
    return new GoogleApiError(
      status,
      "Google ドライブへのアクセスが許可されていません。ログアウトしてもう一度ログインし、ドライブへのアクセスを許可してください",
      reason,
    );
  }
  return new GoogleApiError(status, `Google API エラー（${status}）: ${err.message ?? "不明なエラー"}`, reason);
}
