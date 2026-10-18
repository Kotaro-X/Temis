# Apple審査向け安全対策

## 今回の実装と境界

アカウント単位のOpenAI送信同意、Commons・DMのブロック／通報、Commonsの公開前Moderationを追加。
既存の作業差分を保持。本番デプロイ、移行dry-runを含む本番データ照会・変更、新しいTestFlightビルド、シミュレーター／実機での動作確認は今回の実装完了に含めない。
端末SQLite migration `009_add_embedding_job_account` で埋め込みジョブにUIDを追加する。旧アカウントの保留ジョブは新しいアカウントで送信しない。従来のUID未割当ジョブは明示的な同意時にのみ割り当てる。
Firestoreは `temis-c05aa/(default)`、Standard、`asia-northeast1` を読み取り照会で確認した。

## 利用者の操作

- AIを初めて使う、またはCommonsへ公開する際にOpenAIへの送信説明を表示する。質問・Privateメモ本文・作成者の許可があるProjectメモ断片・公開内容が対象。通常の編集とキーワード検索は同意不要。
- 設定 → アカウント → AIへのデータ送信で説明を確認・同意・撤回できる。同意はサーバーにUID別で保存。撤回すると新しい送信を停止し、本人の投稿を非公開化。送信済みの外部リクエストは取り消せない。再同意だけでは再公開しない。
- Commonsの投稿詳細（AI根拠から開いた場合も同じ）から投稿者をブロック・理由付き通報できる。DM会話から相手をブロック、受信メッセージから理由付き通報できる。
- 設定から自分のブロックを解除できる。相手のブロックは解除できず、繋がりは自動復元しない。
- 運営画面の「投稿の通報」「DMの通報」で対象を確認し対応を完了する。DMは通報されたメッセージだけを保存し、会話全体を運営へ公開しない。
- Commonsに公開するタイトル・本文はOpenAI Moderation APIで確認する。違反判定では非公開。障害時も非公開にして再試行を案内。元メモの保存は妨げない。運営による非表示は再判定で解除しない。

## 将来の本番反映手順

1. 対象checkout・HEAD・全変更差分を固定し、以下の自動検証を完了する。ポリシーURLと運営問い合わせ先の公開、通報対応の担当者／運用を確認する。
2. 既存 `OPENAI_API_KEY` をFunctionsのSecretとして利用する。アプリにキーを設定しない。Moderationの実接続はステージングで別途確認する。
3. `firestore.indexes.json` の追加分（安全判定済み投稿のフィード、DM通報、共有元メモと公開状態の照会）だけを反映してREADYを確認する。既存indexの削除や無関係なindex変更を混ぜない。
4. 次のFunctionsだけを反映する：`updateAIConsent`, `cleanupRevokedAIConsent`, `setUserBlocked`, `reportDirectMessage`, `getConsentedProjectNotes`, `createProjectEmbeddings`, `createEmbeddings`, `generateGroundedAnswer`, `searchGuildPostsWithAI`, `indexGuildPostForAISearch`, `backfillGuildPostAIIndex`, `updateGuildPublication`, `deleteAccount`。必要なIAMのFirestoreアクセスを既存サービスアカウントで確認する。
5. Rulesの全差分を確認して今回の関連変更だけを反映する。直接の投稿作成・本文変更・再公開・ブロック書換は拒否するため、旧アプリにはAI／公開／編集／旧ブロック操作の制限が生じる。新アプリ公開と反映時期を合わせる。旧ビルドへ戻してもRulesを緩めて安全判定を迂回させない。
6. 管理者のApplication Default Credentialsで次のdry-runを実施し件数を確認。その後、別途承認された移行作業としてapplyを実行する。スクリプトは外部AIへ送信せず、未同意／未判定の公開投稿を非公開化する。投稿者が新アプリで同意し、元メモから再公開して判定を通すまで表示しない。

```sh
node scripts/migrate-commons-review-safety.mjs --project temis-c05aa --dry-run
node scripts/migrate-commons-review-safety.mjs --project temis-c05aa --apply
```

同意撤回は同意レコードの保存時点からAI入口で強制する。投稿の非公開化は同期cleanupと再試行可能なFirestore triggerの両方で実施する。cleanup失敗時は完了と表示せず再試行を案内する。

## 検証

自動：typecheck、変更ファイルlint、単体テスト、Firestore／Storage Rules Emulator、`git diff --check`。外部APIはmockで検証し、本番の投稿・DM・アカウントをテストに使わない。

手動：Apple／Google双方で同意拒否→通常編集、同意→AI検索、端末をまたいだ撤回、アカウント切替、Project作成者が未同意の根拠除外、相互ブロック／片方だけの解除、DM送信と通知の停止、運営権限での通報閲覧、判定中の編集／非公開化、障害時の再試行、iPhone／iPadのキーボードとボタン操作。

Apple審査メモには審査用アカウント、AI同意への導線、投稿者ブロック／メッセージ通報の導線、公開時の自動判定、運営連絡先を記載する。App Store Connectのプライバシー申告はOpenAI・Firebase・RevenueCatへの実データ送信と一致させる。

参考： https://developer.apple.com/app-store/review/guidelines/ （1.2、5.1.2）、https://developers.openai.com/api/docs/guides/moderation

## 自動検証記録（2026-10-09）

- `npm run typecheck` 成功。
- 今回変更した関連ファイルのESLint成功（エラー・警告なし）。
- `npm run test:unit` 332件成功。その後の移行判定ハッシュ／共有作成者同意の追加チェックを含む `tests/review-safety.test.ts` 16件も成功。
- `npm run test:firestore-rules` Firestore／Storage Rulesとバックエンド統合36件成功。ローカルEmulatorのみ使用。
- `npm run test:migrations` 5件成功。
- Functions／移行スクリプトの構文確認、indexes JSONの読み取り、`git diff --check` 成功。
- 本番デプロイ・本番移行・OpenAI実接続・シミュレーター／実機確認は未実施。

## Commonsインデックス不足の本番修正（2026-10-10）

実機画像の `The query requires an index` は、フィードに追加した `safety.status == approved` と `safety.version == 1` を含む複合インデックスが本番に未作成だったことが原因。

本番 `temis-c05aa/(default)` の `guildPosts` に、リポジトリの定義に対応する次の2件だけを追加し、双方の `READY` を確認した。

- 通常フィード：`CICAgLiT6IEK`
- タグ絞り込み：`CICAgNjp5ZMK`

`status`・`moderation.visibility`・`safety.status`・`safety.version` の条件と、`publishedAt DESC`／`__name__ DESC` の順序を使う読み取りクエリが成功した。タグの `array-contains-any` を加えたクエリも成功した。本文・認証情報を出力せず、投稿データを変更していない。読み取り時点で通常フィードの条件に該当する投稿は0件だった。

この修正ではRules・Functions・他のインデックス・既存投稿の移行を反映していない。アプリ再ビルドは不要。ユーザーがCommonsの「再試行」または画面の開き直しで確認する。シミュレーター／実機は起動していない。
