# プロフィール必須設定・写真アイコン

更新日: 2026-10-05

## 実装仕様

- ログイン・アカウント切替・保存結果のない初回起動でプロフィール未完了の場合、アプリ全体を必須設定画面に切り替える。再試行とログアウトは可能。未ログイン時は個人タスク・ToDo・メモを利用でき、Commons・Projectはログイン案内を表示する。
- 表示名はtrim後1〜50文字。ユーザーネーム（@ID）は既存の3〜30文字・文字種・予約語・取得済みIDの制約を維持。Firebase AuthのUIDは変更しない。
- 新しい完了日時 `profileCompletedAt`、写真の所有パス `photoStoragePath` をprofilesに追加（どちらも後方互換の任意項目）。名前・IDの所有権・完了日時は同一トランザクション。
- `usernameChangedAt` が設定済みで表示名・@IDが有効な既存プロフィールは、マイグレーションなしで完了扱い。それ以外は既存値を表示して本人に保存を求める。自動生成の仮IDは本人が選ぶIDへの変更が必要。
- 重複IDでは「このユーザーIDはすでに使用されています。別のユーザーIDを入力してください。」を表示。競合時も既存所有者を上書きしない。初回設定後は既存の30日変更制限。
- 任意写真はライブラリから選択・編集して正方形JPEG（最大512px・1MB以下）を保存。撮影機能は含まない。未設定・取得失敗時は人型アイコン。
- DM一覧・送信先・会話ヘッダー・受信メッセージ、Commons一覧・詳細に共通アイコンを表示。

## 保存・同期

写真は `profilePhotos/{uid}/{UUID}.jpg` に保存し、アップロード成功後にprofilesのURLと所有パスを一緒に更新する。既存ファイルの上書きは禁止。公開画像として取得可能だが、列挙は不可。作成・削除は本人のみ。

`syncProfileIdentity` が最新プロフィールを読み、既存Commons投稿とDMプロフィールを100件ずつ取得、10件ずつの同時トランザクションで更新する。古いイベントや再試行でも最新値を使用し、削除済み・閉鎖済みDMの匿名化を復元しない。DMのprivateプロフィールの非表示ポリシーを維持する。クライアントで全投稿の更新成功を待たず、プロフィール保存を完了できる。

写真変更・削除後は、現在参照されていない直前の所有画像を削除する。`cleanupProfilePhotos` は日次で24時間以上経った未参照画像だけを削除する。通信切断で保存結果が不明なときにも、クライアント側では画像を消さず、サーバーが参照状態を確認して削除する。

退会Functionsの `profile_photos` 段階で所有写真を削除し、失敗すればプロフィール・Authの削除前に停止して再試行を求める。プロフィール削除トリガーでも残存写真を回収する。

## 本番反映は別工程

この変更ではデプロイ、IAM変更、Storageの作成、EAS／TestFlight配布は実施しない。

1. 既存Storageのバケットと設定済み `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` が一致することを確認。Functionsの既定バケットも同じものに設定する。現在の本番Storage Rulesとの整合性を確認してからローカルRulesを反映する。
2. `temis-embeddings@temis-c05aa.iam.gserviceaccount.com` のFirestore読み書き・Storage一覧／削除権限を、対象プロジェクト／対象バケットに限定して確認する。退会Functionsの実行アカウントにも写真削除権限が必要。Scheduler関連APIと課金状態も確認する。
3. 承認後の対象は `firestore:rules`、`storage`、`functions:syncProfileIdentity`、`functions:cleanupProfilePhotos`、`functions:deleteAccount`。既存の未配布プロフィールにも対応するため、バックエンドを先に反映する。
4. 新たに追加したexpo-image-picker／expo-image-manipulatorを含むネイティブビルドを作成する。既存のローカルios／androidはGit管理外なので、Podsと権限設定を新しいapp.jsonから反映する必要がある。既存iOSプロジェクトでは `npm run ios:prepare-profile-native`、`npm run ios:check-profile-native` を実行してから `ios/Temis.xcworkspace` でArchiveする。準備スクリプトは既存Podfileを維持して写真Podsと写真ライブラリの使用目的を反映する。JS更新だけではネイティブ依存は追加されない。
5. 旧アプリを強制停止する制約は設けない。新アプリの配布完了まで、旧アプリではプロフィール必須画面は表示されない。

## 自動検証と手動確認

`npm run typecheck`、変更ファイルのESLint、`npm run test:unit`、`npm run test:rules`、`git diff --check`を使用。Rulesテストはdemo-wememoのローカルFirestore／Storageのみで実行する。iOS向けExpo exportはJSバンドル検証であり、ネイティブビルド・起動の証明ではない。

手動確認はユーザーがSimulator／実機で行う。

- Apple・Googleの新規／既存ログイン、再起動、未ログイン利用、プロフィール読み込み失敗・再試行・ログアウト。
- 空入力・不正ID・重複ID・別IDへの再入力、設定済みユーザーのスキップ、30日変更制限。
- 写真選択・クロップ・キャンセル・通信失敗・変更・削除。写真選択中にアカウントが切り替わっても他のアカウントに保存されないこと。
- 別アカウントのDMとCommonsで写真を表示でき、変更・削除が反映されること。未設定時と画像取得失敗時の人型表示、長い名前・小さい画面の表示。
- 共有データ整理後の退会で所有写真が削除され、DMの匿名化が保たれること。

## 2026-10-05 起動クラッシュの調査と修正

実機の `Temis-2026-10-04-235634.ips` はバージョン2.0.0／ビルド105、起動約0.6秒後のSIGABRT。クラッシュ画像のUUIDと10月4日のArchiveのdSYMが一致し、シンボル化すると `RCTExceptionsManager reportFatal` だった。ArchiveのJSには写真機能がある一方、写真ネイティブモジュールがリンクされていなかった。ローカルのPodfile.lock・ExpoModulesProviderにも写真モジュールがなく、使用目的のInfo.plistキーも未設定だった。

写真PodsがないSimulatorビルドで `Cannot find native module 'ExponentImagePicker'` を再現。`profilePhotoService.ts` の起動時importが原因でroot componentを登録できていなかった。写真モジュールは写真選択時のみ読み込み、欠落時は新しいビルドへの更新を案内する。写真削除と通常起動はモジュール欠落でも動作する。欠落したpicker／manipulatorそれぞれの回帰テストを追加した。

既存iOSプロジェクトにExpoImagePicker・ExpoImageManipulator・EXImageLoaderと使用目的を反映し、ネイティブ準備／事前確認スクリプトを追加。実機Debugスクリプトはビルド前に事前確認を実行する。Git管理外のios変更は別checkoutへ自動で引き継がれないため、各checkoutで準備が必要。

ユーザーのSimulator許可に基づき、iPhone 17／iOS 26.2で旧ネイティブ＋修正JS、新ネイティブ＋修正JSの通常画面起動を確認。Debugネイティブビルドも成功した（Pods由来の警告あり）。本番へ保存しない一時検証画面で実際の画像加工を実行し、512×512のJPEG、9,226バイトを確認。一時検証画面とentry変更は検証後に削除・復元した。

写真選択UIは同Simulatorでシステム写真サービスを開始したものの空のモーダルとなり、選択・キャンセルの実行は未確認。編集あり／なしの両方で観測し、原因はまだ確定していない。これは起動時の欠落モジュール例外とは異なる観測であり、写真選択の実機確認は残る。認証済みの写真アップロード・別アカウントからの表示・実際の退会も、本番デプロイと新ビルド後に手動確認が必要。

修正後の再検証: 型チェック、変更対象のESLint、単体テスト226/226、Firestore・Storage Rules／バックエンド連携29/29、iOS向けHermes export、ネイティブ依存事前確認、シェル構文、`git diff --check` が成功。RulesテストはローカルEmulatorで実行。生成済みSimulatorバイナリにもImagePickerModule・ImageManipulatorModuleと写真ライブラリ使用目的が含まれることを確認した。Release Archiveの作成・実機へのインストール・本番デプロイ・配布は今回実施していない。

## 2026-10-05 写真アップロードと確認タイミングの修正

### 写真のBlob変換エラー

実機で表示された `Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported` は、Firebase Web SDKの `uploadString` がbase64からバイナリへ変換し、multipart送信用のBlobを構築する経路とReact NativeのBlob実装が合わないため発生する。

画像加工後のJPEGはbase64へ展開せず、ファイルの実サイズ（1MB以下）を確認する。現在のFirebase AuthトークンでJSONメタデータ付きアップロードセッションを開始し、`expo-file-system/legacy` のネイティブ `uploadAsync` でファイルを直接送信する。認証ヘッダー、正方形／512px制限、JPEG形式、既存Rules、immutableな写真パスを維持する。成功・final状態を確認してURLを取得し、同じアカウントであることを再確認してプロフィールへ保存する。失敗時は現在の写真を保持し、加工した一時ファイルはfinallyで削除する。送信先はFirebase StorageのHTTPSホストに限定し、通信・権限エラーを日本語表示する。

### 必須設定と情報更新の分離

`CollaborationContext.profileSetupStatus` を通常のプロフィール読み込み状態から分離した。状態は `checking`／`required`／`complete`／`signed_out`／`error`。必須設定画面はこの状態を使用する。

- 明示的なログインとアカウント切替では、サーバーのプロフィールを取得して確認する。失敗時は再試行・ログアウトが可能。
- アプリ起動時にFirebaseログインを復元した場合だけ、AsyncStorageの `profile-completion:v1:{FirebaseUID}` を利用する。UID・バージョン・必須項目・完了条件が有効な保存結果があれば通常画面へ進む。保存結果がない初回起動／再インストール／更新直後はサーバーで確認する。
- 完了済みなら、通常起動・画面移動・バックグラウンド復帰で写真や表示名を取得しても設定画面へ戻さない。取得失敗でも通常画面を維持する。別端末で必須項目が変わった場合の再確認は次のログイン時。
- 初回保存成功とプロフィール変更成功後に完了プロフィールを保存する。古いupdatedAtの結果は新しい保存結果を上書きしない。
- ログアウト・アカウント切替で前アカウントの保存結果を消す。退会成功時も、プロバイダーのログアウトや他のローカル削除が失敗しても保存結果を消す。書き込みと削除を直列化し、遅い書き込みがログアウト後の結果を再作成しないようにする。
- 保存媒体の失敗はプロフィール保存成功を取り消さず、保存結果が残らなければ次回起動時にサーバーで確認する。遅延した取得・保存結果は別アカウントへ反映しない。

### 未ログインのCommons・Project

`CommunityAccessBoundary` をProject一覧・共有タスク／ToDo／メモ、Commons一覧／詳細／管理画面の導線に適用。認証とCollaborationのUIDが一致する場合だけ子画面をマウントする。未ログインではログイン案内とアカウント設定へのボタンを表示する。ログアウト・アカウント切替で子画面をアンマウントし、投稿一覧や編集中のモーダルを破棄する。公開投稿を非公開にするRules変更や旧クライアントの強制停止は行わない。

### 検証結果と残る確認

型チェック、変更ファイルのESLint（警告なし）、単体テスト236/236、Firestore・Storage Rules／バックエンド連携30/30、iOS向けHermes export、Simulator Debugネイティブビルド、`git diff --check` が成功。ArrayBufferのBlob生成を禁止したテスト環境でも新アップロード経路が成功した。Storage Emulatorでは実際のJSON開始＋JPEGバイナリ送信・final応答・公開取得が成功し、他人による保存と不正MIMEを拒否した。

ユーザーの許可に基づきiPhone 17／iOS 26.2の一時検証画面でネイティブFileSystemによるローカルHTTP送信を実施し、サーバーで9,226バイトのJPEGを確認。これはファイル送信機能の検証であり、本番の写真保存の証明ではない。一時entryと画面・サーバーを削除／停止し、通常構成のアプリ起動も確認した。

新ビルドの実機では、写真選択・キャンセル・保存・変更・削除、Apple／Googleログイン、設定完了後の通常起動・機内モード起動・アプリ復帰、ログアウト中のCommons／Project制限、別アカウントからの写真表示を確認する。本番デプロイ・Storage準備・Release Archive・配布は別工程。

## 2026-10-05 実機のアップロード失敗と本番設定の調査

実機で一般的な通信エラーが表示されたため、本番状態を読み取り専用で調査した。

- `temis-c05aa.firebasestorage.app` のCloud Storageバケット取得は404「The specified bucket does not exist」。プロジェクト内のバケット一覧にはCloud Functionsのソース／アップロード用バケット2件だけが存在した。
- Firebase既定バケット取得は403。理由はCloud Storage for Firebase APIが未使用または無効であること。
- 本番の有効なStorage Rulesが見つからない。Firestore Rulesにも `profileCompletedAt`／`photoStoragePath` は未反映。`syncProfileIdentity`／`cleanupProfilePhotos` も未デプロイ。

したがって今回の写真保存は、端末の通信を再試行しても成功しない。前回までの本番反映を別工程とする範囲で、サーバー側準備が残っていたことが原因。

クライアントは開始時404・API無効を `PHOTO_STORAGE_NOT_READY` として、運営側の設定が必要な状態を案内するよう修正。401、Rules拒否403、429、5xx、通信失敗、保存結果確認失敗を区別する。ログには分類コード・開始／送信／完了の段階・HTTPステータスだけを記録し、認証トークンやセッションURL、サーバーの生レスポンスは出さない。未準備バケットとAPI無効の回帰テストを追加した。

本番反映の確認対象は `temis-c05aa` に限定する。Cloud Storage for Firebase APIを有効化し、既存設定と同名の既定バケットを東京（asia-northeast1）に作成。Storage Rules・プロフィール追加項目のFirestore Rules・`syncProfileIdentity`・`cleanupProfilePhotos`・`deleteAccount` を限定反映し、実行サービスアカウントへ必要なStorage権限をそのバケットに限定して付与する。料金プランや請求先は変更せず、既存課金状態を確認する。本番準備・デプロイには前回の別工程という合意に基づく追加承認を求めている。

## 2026-10-05 本番反映完了（23:02 JST）

ユーザーの「本番に向けて反映させてください」という承認に基づき、`temis-c05aa` だけへ反映した。

- 既存の課金が有効であることを確認。請求先・料金プランの変更は行っていない。
- `firebasestorage.googleapis.com` を有効化し、Firebaseの既定バケット作成APIで `temis-c05aa.firebasestorage.app` を東京（`ASIA-NORTHEAST1`、STANDARD）に作成。Firebaseの既定バケット情報とCloud Storageのバケット情報の両方で確認した。
- 写真用バケットに限定して、同期・清掃用の `temis-embeddings@temis-c05aa.iam.gserviceaccount.com` と退会用の `9459134170-compute@developer.gserviceaccount.com` に `roles/storage.objectAdmin` を付与。既存のIAM設定は保持した。
- `storage,firestore:rules,functions:syncProfileIdentity,functions:cleanupProfilePhotos,functions:deleteAccount` だけをdry-run後にデプロイ。同期Functionの再試行設定についてFirebase CLIが要求した `--force` を同じ限定対象に適用した。
- 本番APIで3つのFunctionsがすべて `ACTIVE`、各Functionの `FIREBASE_CONFIG.storageBucket` が写真用バケットを指していることを確認。同期Functionの再試行も有効。
- 本番のStorage／Firestore Rulesを読み戻し、ローカルの検証済みファイルとの完全一致を確認した。

反映前の検証は単体テスト237/237、Rules／バックエンド連携30/30、型チェック、変更ファイルのlint、iOS Hermes export、差分チェックが成功。Rulesコンパイルは成功したが既存箇所の警告が残り、Firebase CLIも既存のfirebase-functions依存の更新を案内した。今回の限定反映では依存の更新を行っていない。

本番のログイン済みユーザーによる写真保存は未検証。実機で写真保存・変更・削除、別アカウントからのDM／Commons表示、退会による写真削除を確認する。新しいクライアントのRelease Archive／TestFlight／App Store配布は今回行っていない。既存ビルドで保存を再試行できるが、最新のクライアント修正全体を配布するには別途新ビルドが必要。
