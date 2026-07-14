# 同期観測・障害切り分け Runbook

最終更新: 2026-07-14

## 目的と基本方針

同期失敗時に、本文などの個人情報を収集せず、同じ匿名ユーザーで再発しているか、対象entity、失敗phase、分類、errorCode、再試行回数、処理時間を確認できるようにする。

診断イベントは `src/services/sync/syncDiagnostics.ts` のallowlistで毎回新しいオブジェクトへ再構築する。呼び出し元のオブジェクト、例外、Firestore document、sync payloadをそのままログ・Crashlyticsへ渡してはいけない。診断送信の例外はすべて吸収し、同期結果を変更しない。

## 記録してよい情報

- `anonymousUserId`
- `syncId`
- `entity`（`tag` / `todo` / `task` / `memo`）
- `phase`
- `successCount`
- `failedCount`
- `errorType`
- `errorCode`
- 固定辞書から選ばれた `sanitizedReason`
- `appVersion`
- `osVersion`
- `retryCount`
- `durationMs`
- `schemaVersion`
- `migrationVersion`

## 絶対に記録してはいけない情報

- メモ本文、Todo本文、タスク名、研究ノート本文
- メモ・ノート・研究ノートのタイトル
- ユーザー名、メールアドレス、Firebase UID
- 位置情報
- 添付ファイルの名前・内容・バイナリ
- AIへの入力、prompt、回答本文
- 検索クエリ本文
- sync record / envelope / queue payloadの内容
- 生の例外message、stack trace、Firestore document ID、entity ID

新しい診断フィールドを追加する場合は、先にこの文書とallowlist、PII非混入テストを更新し、レビューを受ける。`...error`、`...record`、`JSON.stringify(payload)` のような実装は禁止する。

## anonymousUserId

`anonymousUserId` は次の入力をSHA-256でhex化した64文字の値である。

```text
SHA256(EXPO_PUBLIC_SYNC_LOG_SALT + NUL + Firebase UID)
```

- Firebase UIDそのものは同期先を選ぶ内部処理にだけ使い、診断イベントには渡さない。
- salt未設定時はversion付きdomain separator `wememo-sync-observability-v1` を使う。
- saltは秘密鍵ではない。辞書攻撃耐性の主目的ではなく、他システムのハッシュ値との横断照合を防ぐdomain separationとして使う。
- Firebase UIDは高エントロピーIDであることを前提とする。
- 同じsaltとUIDなら同じIDになり、再発を追跡できる。
- saltを変更すると過去リリースとの相関が切れる。変更はプライバシー上のローテーションが必要な場合だけ行い、変更日を運用記録に残す。

## sync phase

| phase | 意味 | 主な失敗候補 |
|---|---|---|
| `sync_start` | entity同期の開始 | 診断初期化 |
| `load_local_changes` | ローカルmetadata、queue、recordの読み込み | AsyncStorage、SQLite、migration |
| `fetch_remote_changes` | Firestoreの差分page読み取り | 通信、認証、権限、Firestore read |
| `validate_remote_records` | schemaVersionとrecord形式の検証 | 将来version、破損record |
| `resolve_conflicts` | local/remoteのLWW merge | 比較・競合解決ロジック |
| `write_local_db` | merge結果のSQLite/ローカルstorage反映 | SQLite、transaction、migration |
| `upload_local_changes` | queueからFirestoreへの書き込み | 通信、権限、Firestore write、rate limit |
| `mark_synced` | cursorと成功metadataの保存 | ローカルmetadata保存 |
| `sync_complete` | entity同期の正常終了 | なし |
| `sync_failed` | entity同期の異常終了 | terminal event |

失敗時は、実際に失敗したphaseのerror eventを先に記録し、続けて `sync_failed` を記録する。Crashlyticsのnon-fatal issueは実際の失敗phase側から作るため、どの段階で失敗したかを維持できる。

## errorType

| errorType | 用途 |
|---|---|
| `Network` | offline、timeout、service unavailable |
| `Auth` | 未認証、token失効 |
| `Permission` | Firestore rulesなどの権限拒否 |
| `Validation` | schemaVersion、record形式、remote検証 |
| `LocalDB` | SQLite、AsyncStorage、migration、ローカル書き込み |
| `RemoteDB` | Network/Auth/Permission/RateLimit以外のFirestore read/write |
| `Conflict` | merge・競合解決 |
| `RateLimit` | quota超過、resource exhausted、too many requests |
| `Unknown` | 上記へ安全に分類できない最後の受け皿 |

`Unknown` が継続して発生する場合は、生のmessageを収集するのではなく、再現テストで安全な識別条件を作り、具体分類を追加する。

## errorCodeとユーザー表示

| errorCode | errorType | 開発者向け意味 |
|---|---|---|
| `SYNC-NET-001` | Network | ネットワーク利用不可・timeout |
| `SYNC-AUTH-001` | Auth | 認証なし・token失効 |
| `SYNC-PERM-001` | Permission | Firestore権限拒否 |
| `SYNC-VAL-001` | Validation | schemaVersionが非対応 |
| `SYNC-VAL-002` | Validation | 書き込み前record形式が不正 |
| `SYNC-VAL-003` | Validation | remote record検証失敗 |
| `SYNC-LDB-001` | LocalDB | ローカルDB/storage操作失敗 |
| `SYNC-RDB-001` | RemoteDB | Firestore読み取り失敗 |
| `SYNC-RDB-002` | RemoteDB | Firestore書き込み失敗 |
| `SYNC-CON-001` | Conflict | 競合解決失敗 |
| `SYNC-RATE-001` | RateLimit | quota/rate limit |
| `SYNC-UNK-001` | Unknown | 未分類エラー |

すべての同期失敗で、ユーザーへは以下の安全な共通文面と、開発者ログと一致するerrorCodeだけを表示する。

```text
同期に失敗しました。
時間をおいて再度お試しください。

エラーコード: SYNC-XXX-000
```

生の例外message、stack、record内容、Firebase codeはユーザー文面へ連結しない。ログイン前のCloud Sync操作は既存のログイン案内を表示し、同期処理自体は開始しない。

## sanitizedReason

`sanitizedReason` は分類器が返すsnake_caseの固定辞書値だけを許可する。生の例外messageを正規表現で部分マスクして保存する方式は採用しない。未知の例外は詳細を破棄し、`Unknown` / `SYNC-UNK-001` / `unknown_sync_failure` のみを残す。

分類器は例外の `code` とmessageをメモリ内で分類条件として読むことがあるが、読み取った値をevent、console、Crashlytics、ユーザー表示へコピーしない。

代表的な定型理由は次のとおり。`phase`と組み合わせることで、PIIや生例外なしに読み取り・検証・書き込みを区別する。

| phase・分類 | sanitizedReason |
|---|---|
| `fetch_remote_changes` + RemoteDB | `firestore_read_failed` |
| schema不一致 | `schema_version_mismatch` |
| remote record形式不正 | `remote_record_format_invalid` |
| remote record検証失敗 | `remote_record_validation_failed` |
| `load_local_changes` + LocalDB | `sqlite_read_failed` |
| `write_local_db` + LocalDB | `sqlite_write_failed` |
| `mark_synced` + LocalDB | `sqlite_mark_synced_failed` |
| `upload_local_changes` + RemoteDB | `firestore_write_failed` |

## Crashlytics

Crashlyticsへ送るcustom keysは次の14項目だけである。

- `anonymousUserId`
- `syncId`
- `entity`
- `phase`
- `successCount`
- `failedCount`
- `errorType`
- `errorCode`
- `appVersion`
- `osVersion`
- `retryCount`
- `durationMs`
- `schemaVersion`
- `migrationVersion`

重大な同期失敗は、安全な `errorCode: sanitizedReason` から新規作成した `SanitizedSyncError` をnon-fatalとして記録する。元のErrorを `recordError` へ渡してはいけない。成功phaseはCrashlytics breadcrumb logとcustom keysに残り、その後のnon-fatal/crashの文脈として利用される。

Crashlyticsの初期化、custom key設定、log、recordErrorが失敗しても同期を継続する。debug buildからの送信は `firebase.json` の `crashlytics_debug_enabled: false` とJS sinkの `__DEV__` guardの両方で無効、release/RC collectionは `crashlytics_auto_collection_enabled: true` で有効である。JS exception handler chainingは重複issue回避のため無効にしている。

### Native設定

- Expo Goでは動作しない。config plugin追加後のdevelopment buildまたはproduction buildを使う。
- iOSは `app.json` の `ios.googleServicesFile`（EAS file secretでは `GOOGLE_SERVICES_PLIST` で上書き可能）とstatic frameworks設定を使う。
- iOS Podfileは `withReactNativeFirebaseIos` pluginでRNFirebaseをstatic frameworkとして明示し、RNFirebase非対応のglobal `use_modular_headers!` を除去する。
- Androidで有効化する前に、Firebase Consoleで `com.dotbase.temis` のAndroid appを登録し、正しい `google-services.json` をEAS file secret `GOOGLE_SERVICES_JSON` または `android.googleServicesFile` で指定する。iOS用plistやWeb app IDからAndroid設定を推測・生成してはいけない。
- config plugin変更後はnative project/dev clientを再生成・再ビルドする。
- リリース前にFirebase ConsoleのCrashlytics dashboardでテスト用non-fatalを確認する。テストへ本文や実在ユーザー情報を使わない。

### Platform対応状況（2026-07-14）

- **iOS: RC実送信確認待ち。** `com.anonymous.WeMemo` と一致する `GoogleService-Info.plist`、RNFirebase Crashlytics Pod、dSYM upload build phaseは設定済み。Release Candidateから匿名fixtureによるnon-fatalを1件送信し、Firebase Consoleの `temis-c05aa` で `SanitizedSyncError`、`errorCode`、`phase`、`entity` が見えることをリリース前に確認する。Console受信確認前は本番確認完了と扱わない。
- **Android: 未完了・同時リリース時の残タスク。** 2026-07-14時点のFirebase project `temis-c05aa` のapps一覧はiOSとWebのみで、`platform: ANDROID` の登録はない。repository内にも `google-services.json` がなく、`android.googleServicesFile` は未解決である。Firebase ConsoleでAndroid app `com.dotbase.temis` を登録し、取得した `google-services.json` をEAS file secret `GOOGLE_SERVICES_JSON` に設定する。その後Android RCを再ビルドし、匿名non-fatalのConsole受信とmapping file uploadを確認する。これらが完了するまでAndroid Crashlyticsをリリース完了と扱わない。

## 問い合わせ時の確認手順

1. ユーザーからerrorCode、発生したおおよそのJST時刻、アプリversion、OS、再試行で再発したかを確認する。本文、タイトル、メールアドレスの送付は依頼しない。
2. CrashlyticsでerrorCodeと発生時間を絞り込む。
3. `syncId` 内のbreadcrumbを時系列で確認し、最後の正常phaseと失敗phaseを特定する。
4. `anonymousUserId` で同じユーザーの再発有無を確認する。Firebase UIDやメールへ逆引きしない。
5. `entity`、`errorType`、`retryCount`、`durationMs`、`schemaVersion`、`migrationVersion` を確認する。
6. 下の障害パターンに沿って、認証、rules、schema、SQLite、Firestore statusの順に確認する。
7. `Unknown` の場合も、本番で生ログ追加はしない。匿名fixtureまたはローカル再現で分類条件を追加する。
8. 原因、影響範囲、暫定対応、恒久対応、再発防止テストをincident記録へ残す。anonymousUserIdは必要最小限のアクセス権に限定する。

## よくある障害パターン

| 観測結果 | 第一候補 | 確認・対応 |
|---|---|---|
| `fetch_remote_changes` + `Network` | offline、timeout、Firebase一時障害 | 端末回線、Firebase status、retry後の回復を確認 |
| `fetch_remote_changes` + `Auth` | token失効、session不整合 | sign-out/sign-in、auth state、token refreshを確認 |
| fetch/upload + `Permission` | Firestore rules、grant不整合 | 対象entityのrules、entitlement/grant、Firebase projectを確認 |
| validate + `SYNC-VAL-001` | 新しいschemaを古いappが受信 | app version分布、schema rollout、最低versionを確認 |
| validate + `SYNC-VAL-003` | 破損remote record | failedCountとentityを確認し、payloadをログせず管理者手順で隔離・修復 |
| `write_local_db` + `LocalDB` | SQLite、migration、容量不足 | migrationVersion、空き容量、transaction rollbackを確認 |
| `upload_local_changes` + `RemoteDB` | Firestore write失敗 | Firestore status、index/rules以外のwrite条件を確認 |
| `upload_local_changes` + `RateLimit` | quota/rate limit | Firebase quota、急増したretry、backoffを確認 |
| `resolve_conflicts` + `Conflict` | LWW比較・想定外record | schemaVersion、同時更新fixture、mergeテストを確認 |
| `sync_failed` + `Unknown` | 未分類 | safeな再現fixtureを作り分類器と回帰テストを追加 |

## テストとリリースチェック

```bash
npx tsc --noEmit
npm test
npx expo config --type prebuild
```

最低限、次をレビューする。

- success pathが `sync_start` と `sync_complete` を持つ。
- failure pathが実失敗phaseと `sync_failed` を持つ。
- 9種類のerrorTypeが代表例から分類される。
- user messageにerrorCodeだけが表示され、生message/stackがない。
- allowlist外の本文、タイトル、氏名、メール、位置、添付、AI入力、検索語、UIDがserialized eventとCrashlytics keysにない。
- 同じUID+saltから同じanonymousUserId、別UIDから別IDが作られる。
- Crashlytics sinkがthrowしてもobserverと同期が失敗しない。
- native build後、匿名のテストnon-fatalがFirebase Consoleに到達し、custom keysに禁止情報がない。
