import { loadString, saveString } from "../lib/storage";

/**
 * 見つけた（作成した）フォルダ・台帳の ID を端末に覚えておく。
 * ドライブの検索は作成直後のファイルをすぐ返さないことがあるため、作成直後の再検索で見失わないようにする役割もある。
 */

interface CacheData {
  root?: { id: string; consentedAt?: string };
  ledgers: Record<string, { spreadsheetId: string; yearFolderId: string }>;
}

export class LedgerCache {
  private readonly key: string;

  /** 同じ端末で別の Google アカウントに切り替えても混ざらないよう、ユーザーごとに分ける */
  constructor(userId: string) {
    this.key = `ledger.cache.${userId}`;
  }

  load(): CacheData {
    try {
      const data = JSON.parse(loadString(this.key) ?? "null") as Partial<CacheData> | null;
      return { root: data?.root, ledgers: data?.ledgers ?? {} };
    } catch {
      return { ledgers: {} };
    }
  }

  setRoot(root: { id: string; consentedAt?: string } | undefined): void {
    this.save({ ...this.load(), root });
  }

  setLedger(year: number, ledger: { spreadsheetId: string; yearFolderId: string } | undefined): void {
    const data = this.load();
    if (ledger) data.ledgers[year] = ledger;
    else delete data.ledgers[year];
    this.save(data);
  }

  private save(data: CacheData): void {
    saveString(this.key, JSON.stringify(data));
  }
}
