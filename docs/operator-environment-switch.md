# Temis 運営専用の接続環境切り替え

実装元は `/Users/ktarodoi/WeMemo`。既存のアプリ名・iOS Bundle ID・Android package・EAS project は変更していない。準備コピーを新しい開発元にはしない。

## 実装した構成

| ファイル | 役割 |
| --- | --- |
| `src/services/sync/firebaseApp.ts` | 本番・テストの Auth / Firestore / Functions / Storage が使う Firebase App の選択。プロジェクト・ドメイン・バケット・sender・app ID を照合する。既存ログインを引き継ぐため、本番だけは Firebase の既存 `[DEFAULT]` 名を維持し、テストは `temis-test` 名にする。 |
| `src/services/environment/runtimeEnvironment.ts` | 環境・epoch・15分の有効期限と操作停止を管理。停止中の通常 Firebase getter は拒否する。 |
| `src/services/environment/environmentSession.ts` | 署名付きチケットの交換、専用テストログイン、確定済み環境の保存、起動・復帰確認、更新、両環境のログアウト。遅延した更新やログアウト後の結果を無効化する。 |
| `src/services/account/accountWorkspace.ts` / `src/db/sqlite.ts` | 本番の保存形式を維持し、テストの端末保存・アカウント binding・SQLite を独立させる。テストの AsyncStorage は `@temis/test-environment/` 配下。SQLite は `wememo-account-test-…`。 |
| `src/services/environment/recoveryDrafts.ts` / `switchLifecycle.ts` | 切り替え前の保存と、環境・アカウント別の下書き。メモ・Projectメモ・Projectタスク・ToDoの入力を保持する。 |
| `EnvironmentBoundary.tsx` / `EnvironmentSettings.tsx` | 設定の運営用表示、テスト表示、操作停止、本番へ戻る操作。モーダルにもテスト表示を付ける。 |
| `functions/environmentSessionCore.cjs` / `environmentSession.cjs` | 本番の運営認可、60秒の一回限りチケット、テスト Custom Token。 |
| `functions/commonHandlers.js` / `index.js` / `testEntry.js` | 共通ハンドラーと環境を固定した入口。違うプロジェクトからの入口利用は拒否する。 |
| `functions/environmentRuntime.cjs` | テストの全通常 Callable に有効な利用許可を要求。テストは `OPENAI_API_KEY` だけを要求し、Apple・RevenueCat のシークレットを宣言・使用しない。 |
| `firestore.test.rules` / `storage.test.rules` | 既存 Rules の**すべての allow** に運営テスト利用許可を追加。既存の所有者・Project権限チェックも残す。 |

通常の購入・復元・RevenueCat SDK識別はテストでは行わない。テストの削除はテストの Firebase データだけを対象にし、Apple認証の取り消し・RevenueCat顧客削除・Crashlyticsの外部削除を行わない。全体ログアウトでは両環境の認証を解除するが、保存データは残す。

通知の遷移情報には環境を付ける。別環境の通知から自動切り替えしない。テストのDMプッシュ登録は初期版では無効。ローカルToDo通知は環境を付け、元環境の予定通知を解除し、本番復帰後の既存 bootstrap で復元する。

ネイティブ Firebase の既定アプリは本番のままなので、テスト中は Crashlytics 自動収集を停止し、同期診断の本番送信も停止する。本番復帰時に元の収集設定へ戻す。ネイティブでの反映は端末確認の対象。

## 認可・セッション

- 本番 `temis-c05aa` の Auth ユーザーをサーバーで取得し、`customClaims.environmentSwitcher === true`、無効化・トークン失効状態を確認する。メール、表示名、`staff_free`、端末設定では許可しない。
- `getEnvironmentSwitchCapability` と `issueTestSessionTicket` は本番だけに公開する。発行時に再確認する。
- チケットは RS256、固定 issuer / audience、本番UID、発行時刻、60秒の期限、ランダムな jti を持つ。秘密鍵ファイルは作らず、専用サービスアカウントの Google 管理鍵で IAM `signBlob` を呼ぶ。
- テストの `exchangeTestSessionTicket` は固定署名者の Google 公開証明書・アルゴリズム・発行元・宛先・期限を検証する。jti の Firestore `create` を使って並行した再利用も拒否する。チケット本文は保存しない。
- テストUIDは `operator_` と本番プロジェクト・本番UIDからの SHA-256 で決定する。リクエストで対象UIDを指定できず、本番のメール・プロフィール・メモはコピーしない。
- テストトークンには `testOperator: true` と15分の `testOperatorExpiresAt` を付ける。起動・復帰・前景の10分ごとの更新で、本番の資格から再発行する。更新失敗・期限切れでは操作を止める。本番への復帰はその再認可に依存しない。

## テスト用プラン・シークレット

テストプロジェクトのサーバー管理文書 `operatorTestPlans/<派生テストUID>` に `{ "plan": "plus" }` を設定すると Plus 相当を検証できる。未設定・その他の値は無料。アプリからこの文書へ書くことはできない。テストのアクセス判定は本番の顧客や購入情報を参照せず、既存の24時間キャッシュも流用しない。

外部APIシークレットは、テストの Secret Manager の `OPENAI_API_KEY` を使う。値をチャットやコードに出さず、本番キーをコピーしない。クライアント Firebase 設定は公開の接続情報で、OpenAIなどの秘密キーではない。

テストのプロフィール写真は、恒久的なダウンロードトークン付きURLを使わず、利用許可付きのHTTP読み込みを使う。テスト画像のキャッシュ設定は `private,no-store`。画像処理中も元環境のepochを照合する。

## 実施済みの自動検証（2026-10-18）

- 単体テスト401件成功、skipなし。
- 既存Firestore / Storage Rules 37件と、テスト専用Rules 9件がEmulatorで成功。
- 型チェック成功。変更コードのlintはエラー0件・警告5件。
- iOS向けJavaScript書き出し成功。ネイティブArchive、配布、Simulator・実機操作は行っていない。
- `git diff --check` 成功。テストFunctionsのシークレット宣言が `OPENAI_API_KEY` のみであることを検証。
- 本作業で `app.json` の内容を変更していないことを開始時ハッシュと照合した。

## 検証コマンド

- `npm run typecheck`
- `npm test`（チケット・環境保存・失敗復旧・ログアウト競合・外部副作用拒否を含む）
- 今回の変更ファイルへ `eslint` を実行
- `npm run test:firestore-rules`（既存の本番 Rules 37件）
- `npm run test:environment-rules`（テスト専用 Rules。Firestore / Storage Emulator が必要）
- `npx expo export --platform ios --output-dir /tmp/temis-operator-ios-export`
- `npm run firebase:prepare-operator-test`（生成するだけ。デプロイしない）

`firebase.test.json` はテストの専用 Rules と生成済み `.firebase-test-functions` を指す。本番の `firebase.json` と Rules は変更しない。Rules を変更したら `node scripts/generate-environment-rules.mjs` でテスト用も更新する。

## クラウド反映前に別途確認する差分

**この実装作業では、Firebaseへのデプロイ・IAM変更・運営権限付与・アプリ配布をしていない。** 実機で使える状態になるのは、次の設定をレビューして反映してから。

1. 本番に `temis-environment-signer@temis-c05aa.iam.gserviceaccount.com` を用意し、IAM Credentials API を使えるようにする。鍵ファイルは発行しない。
2. 本番の実行アカウント `temis-embeddings@temis-c05aa.iam.gserviceaccount.com` に、**署名者のサービスアカウントに対してだけ** `roles/iam.serviceAccountTokenCreator` を検討する。本番 Auth の運営資格確認には `firebaseauth.users.get` が必要。既存権限を確認し、不足分だけを提案する。
3. テストの実行アカウント `temis-embeddings@temis-test-c05aa.iam.gserviceaccount.com` に、Custom Token署名のための自身への `roles/iam.serviceAccountTokenCreator` が必要。テスト内のAuth削除・Storage処理の権限も既存状態と照合する。本番データへのアクセス権は与えない。
4. 本番の追加2 API、テストの交換APIと通常Callable、テスト専用Rulesを、対象プロジェクトを明示して反映する。CallableのCloud Run到達権限とFirebase Authの認可は別々に確認する。
5. **人が指定した本番UID** にだけ `environmentSwitcher: true` を付ける。メールや表示名からUIDを自動推定しない。既存 custom claims を保持する。
6. テスト文書 `environmentSessionTickets` の期限後削除は TTL 等で運用する。古いチケットも期限と一回限りの検証で拒否される。
7. 既存のテストプロジェクト・Storage・シークレット・旧テスト専用アプリ登録を再利用し、削除しない。

## ユーザーによる端末確認

Simulator・実機は Codex から起動しない。以下は自動検証とは別の受け入れ確認。

- 通常・匿名・`staff_free`のみのアカウントで運営用UIが出ない。
- 許可された本番アカウントから、専用テストアカウントへ自動で入り、モーダルを含めテスト表示がある。
- 未同期メモ、編集途中のProjectメモ／タスク／ToDo、ゲスト記録、本番の同期OFFが往復後も保持される。
- AI・画像・同期・公開処理中の切り替えと、切り替え途中の強制終了後の復旧。
- テスト状態からの再起動・復帰時の資格確認。オフライン・資格失効・更新失敗でも本番へ戻れる。
- 本番ログインの復元、全体ログアウトで両環境が解除されること。
- テストの購入・復元が無効で、無料／サーバー設定のPlus相当が切り替わる。
- ToDo予定通知・DM通知が別環境へ遷移せず、本番へ戻った後に登録が復元される。

## 反映前のライブ照合（2026-10-18）

クラウドの現状と必要な追加権限は [反映前の確認結果](./operator-environment-cloud-review-2026-10-18.md) に記録した。クラウド設定は変更していない。DM機能5つの入口での公開漏れを修正し、両環境の全ハンドラーを保持する回帰テストを追加した。既存の本番28件・テスト9件と照合し、削除対象0件を確認済み。

## 承認後のクラウド反映（2026-10-18）

承認されたIAM、本番の追加2 API、テスト35 Functions、テスト専用Rulesの反映を完了した。本番の既存28 Functions・本番Rulesは維持。上記の「未反映」は実装・事前確認時点の記録。現在の結果と残る運営UID設定・認証付き確認・端末確認は [クラウド反映結果](./operator-environment-cloud-rollout-2026-10-18.md) を参照。運営権限付与とアプリ配布は未実施。
