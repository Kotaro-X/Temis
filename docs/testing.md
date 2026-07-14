# テスト運用

最終更新: 2026-07-15

## ローカルで使うコマンド

| コマンド | 内容 |
|---|---|
| `npm run lint` | Expo/React Native/TypeScript向けESLint |
| `npm run typecheck` | TypeScript型チェック |
| `npm test` | ローカル向け全Nodeテスト。Emulator未起動時のFirestore Rules placeholder skipを許容する |
| `npm run test:all` | lint、typecheck、unit、migration、Firestore Rules Emulatorテストを順番に実行するローカル総合確認 |
| `npm run test:unit` | Firestore Rulesとmigrationを除いたunit tests |
| `npm run test:migrations` | SQLite migration tests |
| `npm run test:firestore-rules` | Firestore Emulatorを起動してRules実テスト8件を実行する |

ローカルで主要チェックをまとめて確認する場合は、`npm run test:all`を使う。実行順はlint、typecheck、unit test、migration test、Firestore Rules Emulator testで、途中のcheckが失敗した時点で停止する。Firestore Rules Emulator testにはJava 17以上とFirebase Emulatorを実行できる環境が必要である。

`npm test`で表示される`firestore rules tests require emulator`のskipは、ローカルで本番Firestoreへ接続しないための安全策である。ルールが正常という意味ではない。通常の`npm test`だけではFirestore Rulesの正常性を保証できないため、ルール変更時とPR確認では`npm run test:firestore-rules`、またはそれを含む`npm run test:all`を実行する。

## CI

`.github/workflows/ci.yml`はすべてのPull Requestで次の2 jobを実行する。

- `Lint, typecheck, unit, and migrations`
- `Firestore Rules Emulator`

Repository RulesまたはBranch Protectionで両jobをrequired status checksに設定する。特に`CI / Firestore Rules Emulator`を必須化しない限り、workflow追加だけではmergeを技術的に禁止できない。

CIのunit testsは`firestore-rules.test.ts`を除外する。Rules専用jobはEmulatorを起動し、`FIRESTORE_EMULATOR_HOST`が設定された状態で実テストだけを実行する。CIでRulesファイルをEmulatorなしで直接実行すると、skipではなくfailになる。

ローカルでは`npm run test:all`で一括確認し、CIではjobを分割して実行する。CIを`test:all`へ置き換えないことで、lint・型・unit/migration・Rulesのどこで失敗したかをPull Request上で即座に切り分けられる。

## CI環境

- Node.js 22
- Java 17以上（CIはTemurin 17を使用）
- `npm ci`でdevDependenciesを含めて導入
- `firebase-tools`はpackage.json/package-lock.jsonの固定versionを使用
- Firestore Emulator用8080番とEmulator Hub用4400番が利用可能
- 初回のEmulatorバイナリ取得にネットワークが必要

失敗時の分類は[Firestore Rulesテスト運用](./firestore-rules-testing.md)を参照する。
