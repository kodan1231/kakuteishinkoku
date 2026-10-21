import { Link } from "react-router";
import { Page, Section } from "../components/Layout";

// OAuth 同意画面の「プライバシーポリシー」リンク先。ログインなしで表示する。
export function Privacy() {
  return (
    <Page title="プライバシーポリシー">
      <p className="text-sm text-gray-600">制定日: 2026年10月22日</p>
      <p>
        「確定申告サポート」（以下「本アプリ」）は、確定申告（医療費控除など）の準備を行うための個人運営の無料ツールです。本アプリにおける利用者の情報の取り扱いを以下のとおり定めます。
      </p>
      <Section title="1. 取得する情報">
        <p>
          Google アカウントでのログイン時に、メールアドレス・氏名・アカウント識別子を取得します。ログインと利用者の識別のためにのみ使用します。
        </p>
      </Section>
      <Section title="2. 医療費の記録・領収書">
        <p>
          利用者が入力した記録や領収書の画像は、利用者本人の Google ドライブに保存し、運営者のサーバーには保存しません。本アプリが Google ドライブにアクセスできるのは、本アプリが作成したファイルに限られます。
        </p>
      </Section>
      <Section title="3. サーバーで保存する情報">
        <p>利用を許可したアカウントのメールアドレス、招待の記録、領収書読み取り機能の利用回数のみを保存します。</p>
      </Section>
      <Section title="4. 領収書の読み取り">
        <p>
          領収書の読み取り機能を使うと、画像を Cloudflare Workers AI に送信して文字を読み取ります。画像は読み取りにのみ使用し、保存しません。
        </p>
      </Section>
      <Section title="5. 第三者への提供">
        <p>法令に基づく場合を除き、取得した情報を第三者に提供しません。広告やトラッキングにも使用しません。</p>
      </Section>
      <Section title="6. Google ユーザーデータの取り扱い">
        <p>
          Google API から取得した情報の使用および他のアプリへの転送は、Limited Use の要件を含む{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="text-teal-700 underline"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>{" "}
          に従います。
        </p>
      </Section>
      <Section title="7. お問い合わせ">
        <p>kodan1231@gmail.com</p>
      </Section>
      <Link to="/login" className="text-teal-700 underline">
        トップへ戻る
      </Link>
    </Page>
  );
}
