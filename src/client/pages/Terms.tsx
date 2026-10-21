import { Link } from "react-router";
import { Page, Section } from "../components/Layout";

// OAuth 同意画面の「利用規約」リンク先。ログインなしで表示する。
export function Terms() {
  return (
    <Page title="利用規約">
      <p className="text-sm text-gray-600">制定日: 2026年10月22日</p>
      <Section title="1. 利用できる人">
        <p>本アプリは個人が運営する無料のツールで、運営者から招待された人のみ利用できます。</p>
      </Section>
      <Section title="2. 免責">
        <p>
          本アプリが表示する計算結果や出力ファイルの正確性は保証しません。申告内容は利用者自身で確認してください。本アプリの利用により生じた損害について、運営者は責任を負いません。
        </p>
      </Section>
      <Section title="3. 変更・停止">
        <p>本アプリの内容は、予告なく変更・停止することがあります。</p>
      </Section>
      <Section title="4. 記録の管理">
        <p>記録は利用者本人の Google ドライブに保存されるため、利用をやめた後も利用者自身で管理・削除できます。</p>
      </Section>
      <Section title="5. 個人情報">
        <p>
          個人情報の取り扱いは
          <Link to="/privacy" className="text-teal-700 underline">
            プライバシーポリシー
          </Link>
          のとおりです。
        </p>
      </Section>
      <Section title="6. お問い合わせ">
        <p>kodan1231@gmail.com</p>
      </Section>
      <Link to="/login" className="text-teal-700 underline">
        トップへ戻る
      </Link>
    </Page>
  );
}
