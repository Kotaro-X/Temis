# テスト運用

最終更新: 2026-07-15

## 前提条件と初回セットアップ

- Node.js 22（CIと同じmajor version）
- Firestore Rulesを実行する場合はJava 17以上
- Firestore Emulatorの8080番とEmulator Hubの4400番が利用可能なこと

クリーンなcloneでは、lockfileどおりに依存関係を入れる。

```bash
npm ci
```

## ローカルで使うコマンド

| コマンド | 内容 |
|---|---|
| `npm test` | 通常のunit test（Rules・migrationは専用コマンドで実行） |
| `npm run test:migrations` | SQLite migration test |
| `npm run test:rules` | Firestore Emulatorを起動してFirestore Rules testを実行 |
| `npm run test:firestore-rules` | `test:rules` の互換コマンド |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScriptの型チェック |
| `npm run test:all` | 主要チェックの一括実行 |

通常は次で全チェックを再現する。失敗すると後続の処理は実行せず終了する。

```bash
npm run test:all
```

実行順は `lint`、`typecheck`、`npm test`、`test:migrations`、`test:rules`。つまり、通常テスト、SQLite migration、Firestore Rules Emulatorを含む。

Rulesテストの詳細は[Firestore Rules Emulatorテスト](./firestore-rules-testing.md)、migrationの詳細は[SQLite migrationテスト](./migrations.md)を参照する。

## CI

`.github/workflows/ci.yml`はPull Requestごとに、`npm ci`の後で次を実行する。

- lint
- typecheck
- unit test
- SQLite migration test
- Firestore Rules Emulator test（Java 17をセットアップして実行）

CIは失敗場所を分かりやすくするため、品質チェックとRules Emulatorを別jobにしている。両方をGitHubのrequired status checkに設定する。

## テスト後のGit hygiene

テスト後は必ず次を確認する。

```bash
git status
```

`firestore-debug.log`、`firebase-debug.log`、`ui-debug.log`を含む`*.log`、一時DB（`*.sqlite`、`*.sqlite3`、`*.db`）、backup/tmp/coverageディレクトリ、`.env`、`.env.local`は差分に出ない。`.env.example`、`docs/`、`tests/**/fixtures/`配下のDB fixture、Firebase/CI設定はGit管理を維持する。

生成物が表示された場合は、まず`.gitignore`の対象か確認する。すでに追跡済みならローカルファイルを消さず、内容が不要な生成物であることを確認してから `git rm --cached <path>` で追跡だけ外す。秘密情報を含む`.env`を誤ってコミットした場合は、ignore追加だけで済ませず、値を失効・再発行する。
