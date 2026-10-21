import { loadString, saveString } from "../lib/storage";

/**
 * 見つけた（作成した）フォルダ・台帳の ID を端末に覚えておく。
 * ドライブの検索は作成直後のファイルをすぐ返さないことがあるため、作成直後の再検索で見失わないようにする役割もある。
 */

interface CachedLedger {
  spreadsheetId: string;
  yearFolderId: string;
  receiptFolderId?: string;
}

interface CacheData {
  root?: { id: string; consentedAt?: string };
  ledgers: Record<string, CachedLedger>;
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

  setLedger(year: number, ledger: CachedLedger | undefined): void {
    const data = this.load();
    if (ledger) {
      const { spreadsheetId, yearFolderId, receiptFolderId } = ledger;
      data.ledgers[year] = { spreadsheetId, yearFolderId, receiptFolderId };
    }
    else delete data.ledgers[year];
    this.save(data);
  }

  private save(data: CacheData): void {
    saveString(this.key, JSON.stringify(data));
  }
}
