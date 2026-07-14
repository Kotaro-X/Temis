# SQLite migrationテストと運用

最終更新: 2026-07-15

## 目的

SQLite schemaをアプリ更新後も安全に最新版へ移行する。実装は`src/db/migrations.ts`、テストは`tests/migrations.test.ts`に置く。

## `schema_migrations`の考え方

`schema_migrations`は適用済みmigrationのversionと適用時刻を記録する台帳である。起動時に未適用versionだけを順番にtransaction内で実行し、成功後にversionを記録する。失敗時はrollbackするため、versionを記録せずに次回安全に再試行できる。

## migrationを追加するルール

1. `MIGRATIONS`の末尾に、連番で一意な新しいversionを追加する。
2. migrationは既存DBに対して安全に実行でき、必要なら`IF NOT EXISTS`または存在確認を使う。
3. すでにリリースしたmigrationのversionやSQLを変更・削除しない。修正は必ず新しいmigrationとして追加する。
4. schema変更と同時にmigration testを追加または更新する。
5. 実機のユーザーDBや生成したDBをfixtureとしてコミットしない。必要なfixtureは最小・匿名化済みのものを`tests/**/fixtures/`に置く。

## テスト実行

```bash
npm run test:migrations
```

このテストは次を確認する。

- 新規DBが最新版schemaと全migration記録で作成される
- 旧schemaのDBが最新版と同じschemaへ移行される
- 適用済みmigrationが再実行されない
- migration途中の失敗がrollbackされ、記録されない
- 失敗後の再実行で正しく完了する

`npm run test:all`とPR CIにもこのコマンドが含まれる。

## fixtureの扱い

現在のmigration testはNode上のSQLite adapterを使ったin-memory testで、実DB fixtureを必要としない。将来fixtureを追加する場合は、テスト専用・最小・匿名化済みのファイルを`tests/**/fixtures/`配下に置く。この場所の`*.sqlite`、`*.sqlite3`、`*.db`は`.gitignore`の例外として追跡できる。一時的に生成したDB、端末から取り出したDB、backupはコミットしない。

## よくある失敗

| 症状 | 確認・対処 |
|---|---|
| 既存DBだけ失敗する | 旧schemaからの経路をテストで再現し、必要な新規migrationを追加する |
| 再起動のたびに同じSQLが走る | `schema_migrations`への記録とversionの一意性を確認する |
| 途中失敗後にDBが壊れる | transaction範囲とrollback、migration recordの実行順を確認する |
| fixtureがGitに現れない | `tests/**/fixtures/`配下か、`.gitignore`の例外パターンか確認する |

## CI

PR CIのquality jobが、`npm ci`の後に`npm run test:migrations`を実行する。ローカルで同じ検証をする場合は`npm run test:all`を使う。
