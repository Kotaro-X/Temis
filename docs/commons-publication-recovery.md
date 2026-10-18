# Commons投稿の本番復旧（2026-10-10）

## 原因と現状

現在のアプリは投稿前に `aiConsents/{uid}` をサーバーから読み、必要に応じて `updateAIConsent` を呼ぶ。
本番Functions一覧に `updateAIConsent` と `cleanupRevokedAIConsent` は存在せず、本番Rulesにも `aiConsents` の所有者読み取り許可がなかった。
そのため未同意状態の確認が権限エラーになり、メモ画面の「公開内容を更新できません」で止まる。

前回追加したフィード用インデックスはREADYだが、同意・公開処理の反映は別途必要。
初回の本番反映は、以前の「コードと自動検証まで／本番デプロイなし」の指定を理由に自動承認レビューに拒否された。その後、利用者から対象5 Functionsと投稿関連Rulesの本番反映について明示的な承認を受け、2026-10-10に限定反映を完了した。投稿データの移行・同意の代理付与・実アカウント削除は実行していない。

## 反映済み対象

| 対象 | 目的 |
|---|---|
| `updateAIConsent` | アカウント別の同意を保存し、投稿前の確認を通す |
| `cleanupRevokedAIConsent` | 同意撤回後の公開停止を再試行可能にする |
| `updateGuildPublication` | 同意・安全判定を確認してから公開する |
| `indexGuildPostForAISearch` | 公開停止・判定状態・作成者同意とAI索引を一致させる |
| `deleteAccount` | アカウント削除時に新しい同意データも削除する。関数の更新だけで、実アカウントの削除処理は呼び出さない |
| Firestoreの投稿関連Rules | 自分の同意状態だけを読み取り可能にし、本文の直接作成・編集・再公開による安全判定の迂回を禁止する |

Rulesは取得した本番のソースを基準に、`validGuildPost`、`guildPostIsVisible`、`guildPosts`、`aiConsents` の部分だけを更新した限定ファイルを準備した。
既存のProject・DM・その他のRulesは維持する。作業中の `firestore.rules` 全体をそのままデプロイしない。
限定Rulesとconfigは `/private/tmp/wememo-publication-deploy.rules`、`/private/tmp/wememo-publication-deploy.json` に準備済み。

投稿の移行、同意の代理付与、実ユーザーでの試験投稿、他のFunctionsの反映は行わない。
同意は利用者本人がアプリの説明を読んで操作する。新しい同意処理は旧アプリの公開処理と互換ではないため、手動確認には今回の変更を含むビルドを使用する。

## 実行した限定コマンド

```sh
./node_modules/.bin/firebase deploy --only functions:updateAIConsent,functions:cleanupRevokedAIConsent,functions:updateGuildPublication,functions:indexGuildPostForAISearch,functions:deleteAccount --project temis-c05aa --non-interactive --force
./node_modules/.bin/firebase deploy --only firestore:rules --config /private/tmp/wememo-publication-deploy.json --project temis-c05aa --non-interactive
```

実行前に本番Rulesを再取得し、準備時から変更がないことを確認した。`--force` は撤回後処理の再試行設定をCLIが要求したため追加した。対象は上記5 Functionsのみ。

反映後にGoogle Cloud Functions APIで5 FunctionsすべてのACTIVEを確認した（更新時刻は2026-10-10 09:51〜09:52 JST）。`updateAIConsent` の未認証POSTはHTTP 401 / UNAUTHENTICATEDで応答し、到達性と認証ガードを確認した。本番Rulesは限定ファイルと完全一致する。Secret値は表示・保存していない。

本人としての同意・公開操作とOpenAI安全判定の実行は未検証。実投稿の成功確認は下記の手動確認で行う。

## 自動検証

- 同意・公開・世代競合・撤回・アカウント切替の関連21テスト成功。
- 限定RulesのApple／Google両方の権限テスト成功（ローカルFirestore Emulator）。未同意レコードの読み取り、他人の同意の閲覧拒否、同意の偽装拒否、判定済みフィードの読み取り、直接編集・再公開の拒否を確認。
- 対象5 Functionsのモジュール読み込み／endpoint登録確認成功（外部API呼び出しなし）。
- typecheck、変更テストのlint、`git diff --check` 成功。
- Rulesの構文検証にエラーなし。既存の未使用関数などの警告が5件ある。

## 手動確認

本番反映後、アプリでメモを保存 → Commonsへの投稿 → 送信説明に同意 → 公開、を確認する。
続けて本文編集、非公開化、同意撤回を確認する。本人の同意・プロフィールの公開設定・安全判定で止まる場合は、その詳細を確認する。
シミュレーター・実機はCodexで起動していない。
