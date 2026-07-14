# Firestore Rules Emulatorテスト

最終更新: 2026-07-15

## 目的

`firestore.rules`を本番Firestoreへ接続せずに検証する。未ログインや他ユーザーのアクセスを拒否し、所有者だけが許可された同期データを正しい形式で読み書きできることを確認する。Rules testは必須のPR検証であり、通常のunit testの代替ではない。

## 前提条件

- `npm ci`を実行済み（local `firebase-tools`を使用）
- Java 17以上
- 8080番と4400番が空いていること
- 初回のEmulator binary取得時にネットワークへ接続できること

## Emulatorの起動とテスト実行

手動でEmulatorを起動し続ける必要はない。次のコマンドが、`demo-wememo` project IDでFirestore Emulatorを起動し、終了後に停止する。

```bash
npm run test:rules
```

この処理はJava、local Firebase CLI、ポートを確認してから、`FIRESTORE_EMULATOR_HOST`が設定された子プロセスで`tests/firestore-rules.test.ts`を実行する。`npm run test:all`にも含まれる。互換名の`npm run test:firestore-rules`も同じ処理を実行する。

## 対象ルールと代表ケース

同期可能なユーザー所有データは`users/{uid}`配下の`tags`、`todos`、`tasks`、`memos`のallowlistのみである。テストは少なくとも次を確認する。

- 未ログインユーザーは読み書きできない
- 所有者は自分の許可済みcollectionを読み書きできる
- 他ユーザーは所有者のデータを読み書きできない
- 未許可subcollectionや未知フィールドを拒否する
- 不正な型・過大値・不正な更新形式を拒否する
- 論理削除、staff grant、invite redemptionの許可条件を検証する

## よくある失敗

| marker | 原因 | 対処 |
|---|---|---|
| `[java-error]` | Java不足またはversion不適合 | Java 17以上を導入する |
| `[firebase-cli-error]` | local Firebase CLIなし | `npm ci`を再実行する |
| `[port-conflict]` | 8080/4400番が使用中 | 残存Emulatorや該当processを停止する |
| `[configuration-error]` | Emulator host未設定 | `npm run test:rules`経由で実行する |
| `[emulator-startup-error]` | Emulator起動・download・CLI環境の失敗 | Java、ネットワーク、Firebase debug logを確認する |
| `[assertion-failure]` | Emulator起動後にRules assertionが失敗 | `firestore.rules`と該当テストを修正する |

`EPERM`やport conflictはRulesロジックの失敗とは分けて扱う。Emulatorが生成する`firestore-debug.log`などはGit管理しない。

## CI

`.github/workflows/ci.yml`の`Firestore Rules Emulator` jobがPRごとに`npm ci`、Java 17のセットアップ、`npm run test:rules`を実行する。GitHubのRepository RulesまたはBranch Protectionでは`CI / Firestore Rules Emulator`をrequired status checkに設定する。
