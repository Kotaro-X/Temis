# Firestore Rules Emulatorテスト運用

最終更新: 2026-07-15

## 実行方法

```bash
npm run test:firestore-rules
```

`npm run test:all`でも、このFirestore Rules Emulator testが最後に実行される。

このコマンドはlocal devDependencyの`firebase-tools`を使い、次を行う。

1. Java 17以上を確認する。
2. Firestore Emulatorの8080番とEmulator Hubの4400番が空いていることを確認する。
3. 本番ではない`demo-wememo` project IDでEmulatorを起動する。
4. Firebase CLIが子プロセスへ設定した`FIRESTORE_EMULATOR_HOST`を必須確認する。
5. `firestore.rules`を読み込み、`tests/firestore-rules.test.ts`の実テスト8件を実行する。
6. 成否にかかわらず`firebase emulators:exec`がEmulatorを停止する。

通常の`npm test`ではEmulatorを自動起動しない。ローカルで`FIRESTORE_EMULATOR_HOST`がない場合だけ、`firestore rules tests require emulator`をskipする。`CI=true`または`FIRESTORE_RULES_TEST_REQUIRED=1`では同じ状態をfailとして扱う。

## 検証対象

- 所有者が自分の`tags`、`todos`、`tasks`、`memos`だけを操作できること
- unknown subcollectionをowner/adminともに操作できないこと
- unknown fields、不正型、過大値を拒否すること
- stale updateを拒否し、logical tombstoneを許可すること
- 一般ユーザーがstaff grantを自己付与できないこと
- admin claimによるstaff grantを許可すること
- `invite_free`を所定transaction形状だけで利用できること
- grant/redemptionを伴わないinvite counter更新を拒否すること

## 失敗ログの見分け方

| marker | 分類 | 対応 |
|---|---|---|
| `[java-error]` | Java不足・version不適合 | Java 17以上を導入する。CIはTemurin 17を使う |
| `[firebase-cli-error]` | local Firebase CLIなし | `npm ci`を再実行し、devDependenciesを確認する |
| `[port-conflict]` | 8080/4400番競合 | 残存Emulatorや別processを停止する。ルール不具合として扱わない |
| `[configuration-error]` | Emulator host未設定 | `npm run test:firestore-rules`経由で実行する |
| `[emulator-startup-error]` | Emulator起動・download・CLI実行環境の失敗 | Java、network、Firebaseログ、Emulator Hubを確認する |
| `[assertion-failure]` | Emulator起動後のRules assertion失敗 | `firestore.rules`と該当fixtureを確認する |
| `[success]`、`[complete]` | 8件成功・正常停止 | ルールテスト成功 |

`EPERM`、`Could not start emulator hub, port taken`、8080番競合は実行環境障害であり、Rules assertion failureとは分けて記録する。`firestore-debug.log`はEmulator実行で更新される生成ログであり、意図した調査を除いてコミットしない。

## CIの必須化

`.github/workflows/ci.yml`の`Firestore Rules Emulator` jobがすべてのPull Requestでこのコマンドを実行する。GitHubのRepository RulesまたはBranch Protectionでは、次をrequired status checkに登録する。

```text
CI / Firestore Rules Emulator
```

workflow jobが失敗した場合、Rules未実行のままmergeしない。workflow名やjob名を変更するとrequired checkの名前も変わるため、Repository Rules側も同時に更新する。

## 依存version

`firebase-tools`はグローバルinstallationを使わず、package.jsonのdevDependencyへexact versionで固定する。CIは`npm ci`を使い、package-lock.jsonと一致しないinstallationを失敗させる。
