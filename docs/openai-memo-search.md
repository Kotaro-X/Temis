# OpenAI AIメモ検索の有効化

AIメモ検索は、メモ本文と検索語から埋め込みを作り、端末内の類似検索に利用します。OpenAI APIキーはアプリやExpoの環境変数には保存せず、Firebase Callable Functionだけが参照します。

## 1. AI検索専用の実行サービスアカウントを作成

Google Cloud ConsoleでFirebaseプロジェクト `temis-c05aa` を選び、次のサービスアカウントを作成します。

- 名前: `Temis Embeddings`
- ID: `temis-embeddings`
- アプリケーションにキーをダウンロードする必要はありません。

このFunctionは、この専用サービスアカウントで実行します。FunctionをデプロイするGoogleアカウントには、このサービスアカウントに対する `Service Account User` ロールが必要です。Firebase CLIは、デプロイ時に `OPENAI_API_KEY` のSecret Accessor権限をこの実行サービスアカウントへ自動付与します。

## 2. OpenAI APIキーをFirebaseに登録

OpenAI Platformでプロジェクト用の通常APIキーを作成してから、リポジトリのルートで実行します。キーをチャット、`.env.local`、`EXPO_PUBLIC_*`変数へ貼り付けないでください。

```bash
npx firebase functions:secrets:set OPENAI_API_KEY --project temis-c05aa
```

入力を求められたら、OpenAI APIキーを直接入力します。

## 3. Functionをデプロイ

```bash
npx firebase deploy --only functions:createEmbeddings --project temis-c05aa
```

このFunctionは `asia-northeast1` で実行されます。Firebase Functionsの利用に必要な課金プラン・権限は、対象Firebaseプロジェクト側であらかじめ有効にしてください。

## 4. アプリの公開設定を切り替え

ローカル開発用の `.env.local` と、リリース用のEAS環境変数に次を設定します。

```dotenv
EXPO_PUBLIC_EMBEDDING_PROVIDER=openai
EXPO_PUBLIC_OPENAI_FUNCTION_REGION=asia-northeast1
```

設定を反映するため、Expo開発サーバーまたはアプリを再起動します。既存メモの埋め込みは、アプリ起動後に既存のバックグラウンドジョブで順次生成されます。

## 動作確認

1. アプリでGoogleログインする。
2. メモ検索を開き、`AI検索` を選択する。
3. 「会議で決まったこと」のような自然文で検索する。
4. 結果を開き、元のメモへ遷移できることを確認する。

未ログインの場合、埋め込みジョブは失敗扱いにせず保留され、ログイン後に再試行します。Functionは1回につき最大20件、各4,000文字、合計40,000文字に制限されます。

## データと運用

- メモの保存・検索結果は端末内SQLiteに残り、OpenAIには埋め込み生成の入力だけを送ります。
- FunctionはFirebase認証を必須にし、APIキーやメモ本文をログ出力しません。
- リリース前にFirebase App CheckとOpenAI側の利用上限・アラートを有効化することを推奨します。
