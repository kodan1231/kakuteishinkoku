/**
 * 更新用トークン（refresh token）を端末の IndexedDB に保存する。
 * 取り出し不可（non-extractable）の AES-GCM 鍵で暗号化し、鍵そのものも IndexedDB に保存する。
 * 鍵の中身はスクリプトから読み出せないため、保存データだけを持ち出されても復号できない。
 */

const DB_NAME = "kakutei-auth";
const STORE = "kv";
const KEY_ID = "encryption-key";
const TOKEN_ID = "refresh-token";

interface EncryptedValue {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, f: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function getKey(): Promise<CryptoKey> {
  const existing = await withStore<CryptoKey | undefined>("readonly", (s) => s.get(KEY_ID));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await withStore("readwrite", (s) => s.put(key, KEY_ID));
  return key;
}

export async function saveRefreshToken(token: string): Promise<void> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  await withStore("readwrite", (s) => s.put({ iv, data } satisfies EncryptedValue, TOKEN_ID));
}

export async function loadRefreshToken(): Promise<string | null> {
  try {
    const value = await withStore<EncryptedValue | undefined>("readonly", (s) => s.get(TOKEN_ID));
    if (!value) return null;
    const key = await getKey();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: value.iv }, key, value.data);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function clearRefreshToken(): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(TOKEN_ID));
  } catch {
    // 削除できなくても、次回の更新で失効が検知される
  }
}
