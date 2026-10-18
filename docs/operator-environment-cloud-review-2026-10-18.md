# Temis 接続環境切り替え：反映前の確認結果

確認日時：2026-10-18T04:14:42.422Z（日本時間 2026-10-18 13:14頃）。クラウドは読み取りだけで、設定変更・デプロイ・運営ユーザーの権限付与をしていない。Secretの値とAuthユーザー一覧も取得していない。

## 現在使えるもの

| 確認項目 | 本番 `temis-c05aa` | テスト `temis-test-c05aa` |
| --- | --- | --- |
| プロジェクト・課金 | ACTIVE・課金有効 | ACTIVE・課金有効 |
| Firestore | 東京・既存DBあり | 東京・既存DBあり |
| Storage | 東京・既存バケットあり | 東京・既存バケットあり |
| IAM Credentials / Auth / Functions / Cloud Run等 | 必要APIは有効 | 必要APIは有効 |
| 実行用サービスアカウント | 既存・有効 | 既存・有効 |
| 既存Functions | 28件・すべてACTIVE | 9件・すべてACTIVE |
| テストOpenAIシークレット | 今回の確認対象外 | `OPENAI_API_KEY`あり・有効なバージョンあり |

課金プランの再設定、別のFirebaseプロジェクト・Storageの作成、新しいAPIキーの入力は不要。OpenAIシークレットの**値の正しさやAIの応答**は、まだ実行検証していない。

## 追加する権限案（未実施）

目的は、運営資格の確認、テストセッションへの署名、テスト内のAI・写真・アカウント削除を動かすこと。

| 対象・付与先 | ロール／権限 | 適用範囲 |
| --- | --- | --- |
| 本番の専用署名アカウント `temis-environment-signer@temis-c05aa.iam.gserviceaccount.com` | サービスアカウントを新規作成 | 秘密鍵ファイルは発行しない。署名以外のプロジェクト権限は与えない |
| 本番実行アカウント `temis-embeddings@temis-c05aa.iam.gserviceaccount.com` | 専用ロール `temisEnvironmentUserReader`：`firebaseauth.users.get` のみ | 本番プロジェクト。運営資格・無効化・失効時刻の確認。Auth設定変更やユーザー削除は許可しない |
| 同じ本番実行アカウント | `roles/iam.serviceAccountTokenCreator` | 上記の専用署名アカウントだけ。プロジェクト全体には付与しない |
| テスト実行アカウント `temis-embeddings@temis-test-c05aa.iam.gserviceaccount.com` | `roles/iam.serviceAccountTokenCreator` | 自身のサービスアカウントだけ。Custom Token署名用 |
| 同じテスト実行アカウント | 専用ロール `temisTestAuthDeletion`：`firebaseauth.users.delete` のみ | テストプロジェクト。広いFirebase Auth管理者ロールは付与しない |
| 同じテスト実行アカウント | `roles/storage.objectAdmin` | テストの既存バケットだけ |
| 同じテスト実行アカウント | `roles/secretmanager.secretAccessor` | テストの `OPENAI_API_KEY` だけ |

本番の署名アカウントは現在404（未作成）。実行アカウントのプロジェクト直下の既存ロールは、両環境とも `roles/datastore.user` と `roles/eventarc.eventReceiver`。本番Storageの既存権限はそのまま使う。テストのStorage・OpenAI Secretへの直接付与は未設定。

この一覧はプロジェクト・サービスアカウント・バケット・Secret直下のIAMを照合したもの。組織・グループからの継承権限までは評価していない。専用ロールで使う `firebaseauth.users.get`・`firebaseauth.users.delete` は、現在のGoogle Cloud権限メタデータでカスタムロール利用可能（SUPPORTED）と確認した。反映直前にも既存policyを再取得し、version 3・条件付きbinding・etagを保持して、不足分だけを追加する。

## 反映するAPIとRules

- **本番：追加するのは2つだけ**。`getEnvironmentSwitchCapability`、`issueTestSessionTicket`。
- 本番の既存28 Functions、Firestore Rules、Storage Rules、indexは今回更新しない。ローカルには他の未反映変更もあるため、本番への一括デプロイは行わない。
- **テスト：35 Functions**。既存9件を更新し、26件を追加する。削除対象は0件。AIのシークレット宣言は `OPENAI_API_KEY` のみ。
- テストの既存Firestore Rulesには運営利用許可チェックがなく、Storageは現在全面拒否。両方を準備済みの運営セッション必須Rulesへ置き換える。
- 新しいCallableにはCloud Runの到達権限 `roles/run.invoker` / `allUsers` が必要。対象サービスだけに限定する。HTTPで到達できても、Firebase Auth・運営資格・テスト利用期限の検証に通らない利用者は拒否する。チケット交換だけは署名付き一回限りチケットで検証する。
- 運営ユーザーへの `environmentSwitcher: true` は、**人が明示した本番UIDの確認後**に行う。今回の反映承認だけで任意のユーザーに付与しない。

## 反映前に修正した漏れ

前回の入口分離で、共通ハンドラー内の分割代入によるDM機能5つが、本番・テストの入口から抜けていた。今回のライブ一覧との照合で発見し、ローカルで修正した。

`sendDirectMessage`、`markDirectMessagesRead`、`setDirectMessageDevice`、`notifyDirectMessage`、`retryDirectMessageNotifications` を両方の入口へ復元。全共通ハンドラーと入口の一致を検証する回帰テスト2件を追加した。クラウドは更新前なので、運用中のDMにはこの漏れを反映していない。

修正後の確認：単体テスト401件成功・skipなし、型チェック成功、今回修正した3ファイルのlint成功、差分形式チェック成功。実際の本番・テストの既存Functionsと再照合し、削除対象0件を確認した。前回のRules Emulator計46件・iOS書き出しはアプリ／Rulesに変更がないため繰り返していない。

## 承認後の順序

1. 上記の署名アカウント・限定IAMを追加し、権限を再確認。
2. 本番は明示した2 APIだけを追加する。
3. テストの35 Functionsを反映し、すべての通常Callableの運営利用許可チェックと、HTTP到達権限を確認。
4. テスト専用Rulesのみ反映。既存のテストアプリ登録やシークレットは削除しない。
5. UIDを確認して運営権限を付与し、認証を通した往復テストへ進む。アプリ配布・端末確認はその後の段階。

この承認範囲には、アプリ配布、端末起動、本番業務データの変更、本番既存Functions／Rulesの一括反映、メールや表示名からの運営UID推定を含めない。

詳細な対象一覧：[反映対象JSON](./operator-environment-cloud-changes.json)。このJSONはレビュー用の提案で、自動適用する実行ファイルではない。

## 承認後のクラウド反映（2026-10-18）

承認されたIAM、本番の追加2 API、テスト35 Functions、テスト専用Rulesの反映を完了した。本番の既存28 Functions・本番Rulesは維持。上記の「未反映」は実装・事前確認時点の記録。現在の結果と残る運営UID設定・認証付き確認・端末確認は [クラウド反映結果](./operator-environment-cloud-rollout-2026-10-18.md) を参照。運営権限付与とアプリ配布は未実施。
