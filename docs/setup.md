# セットアップ手順

## 前提
- Node.js 22 以上
- Cloudflare アカウント（Worker `kakuteishinkoku` 作成済み）

## 初回
```sh
npm install
npx wrangler login   # ブラウザで Cloudflare にログイン
```

## Step 0: OCR 検証ページを使う

1. 検証ページ用の合言葉を Worker に設定する（任意の文字列。他人に推測されにくいもの）
   ```sh
   npx wrangler secret put OCR_LAB_KEY
   ```
2. デプロイする
   ```sh
   npm run deploy
   ```
3. スマホまたは PC で `https://kakuteishinkoku.<サブドメイン>.workers.dev/lab/ocr` を開く
4. 合言葉を入力し、比較するモデルを選び、領収書の写真を選択して「読み取り実行」
   - 写真は端末で長辺 1024px に縮小してから送信される。サーバーには保存されない
   - 正解（日付・支払先・金額）を入力すると、モデル別の集計表に正解数が出る
5. 結果のスクリーンショットを共有する
6. Cloudflare ダッシュボードの「Workers AI」で Neuron の消費量を確認し、あわせて共有する

### 注意
- Workers AI の無料枠は 1日 10,000 Neurons。大型モデル（Kimi など）は消費が大きい可能性があるため、最初は1〜2枚で試す
- Llama 3.2 Vision は初回にライセンス同意が自動送信される（Meta のライセンスに同意したことになる）
- 検証が終わったら合言葉を削除すると、検証 API は無効になる
  ```sh
  npx wrangler secret delete OCR_LAB_KEY
  ```

## ローカル開発
```sh
echo 'OCR_LAB_KEY=任意の文字列' > .dev.vars
npm run dev
```
Workers AI はローカルでもリモートの Cloudflare に接続するため、`wrangler login` 済みである必要がある（利用量は無料枠から消費される）。
