# Projectタスク編集のキーボード停止対策

## 確認できたコード上の問題

編集画面の外側ScrollView内に、TaskMemoFieldsのKeyboardAvoidingView（iOSではpadding）と内側ScrollViewが入っていた。メモ欄のKeyboardAvoidingViewは、タスク名など別の入力欄でキーボードを開いてもイベントを受け取る。

React Native 0.81.5の実装は、ビューの高さが変わると回避量を再計算し、その回避量をpaddingBottomに設定する。高さがコンテンツと自身のpaddingで決まる条件では「高さ増加→回避padding増加→高さ増加」の連鎖になる。

搭載中のKeyboardAvoidingView.jsを実行する検証で、内容の初期高さ300px・配置y=400px・キーボード上端500pxを与えると、コンテンツ高さが自身の回避paddingを含むケースではpaddingが200→400→600→800→1000→1200→1400→1600pxと増え続けた。独立した固定高さのケースでは200pxのまま収束する。

これは実際のRN計算処理にレイアウト条件を与えた検証であり、実機のYogaレイアウト・クラッシュスタックを取得して再現した検証ではない。今回の実機クラッシュと同じスタックであることは、ログ取得まで未確定。

## 修正

- TaskMemoFieldsを通常のViewによる内容表示に変更し、内側KeyboardAvoidingView・ScrollView・flex:1を除去。
- Projectタスク編集は、画面内で高さを持つ外側ScrollViewだけでスクロールする。iOSではautomaticallyAdjustKeyboardInsetsでネイティブのキーボード余白調整を使用し、内容自身の高さをJSで増やさない。
- 同じメモ部品を使うPrivateのTaskDetailScreenも、外側ScrollViewに同じキーボード余白調整を設定。
- 所有者選択、保存、下書き、Wikiリンク、カーソル・選択処理、既存のmemo-editor専用iOSパッチは維持。

ScrollViewの高さを制限する要件とキーボード余白調整は[React Native公式ドキュメント](https://reactnative.dev/docs/scrollview)でも確認した。

## 検証

- 型チェック: 成功。
- 単体テスト: 全306件成功。
- 新しい6件の回帰テスト: RNの上記計算の発散・収束、実コンポーネントを展開したProject／PrivateのiOS／Androidでの単一スクロール・高さ制限・内側回避処理なしを確認。
- 入力・括弧・カーソル・保存関連を含む対象テスト34件: 成功。
- 変更ファイルのeslint: エラー0・警告0。
- node scripts/patch-rn-textinput-scroll.mjs --check: 適用済みを確認。
- git diff --check: 成功。

## 送信ログの確認

ユーザーから送信先はTestFlight／Appleとの回答を得た。Xcode OrganizerのCrashesとFeedbackを確認し、Reload Organizerも実行したが、表示されたのは旧版1.2.3の記録で、今回の2.0.0の報告はまだ取得できなかった。Xcodeは閲覧後に元のArchives画面へ戻した。

参考としてCrashlyticsにも照会したが、直近24時間の結果はなく、7日間の結果は10月5日（JST）のExponentImagePicker不足に関する旧イベント2件のみ。今回のキーボード問題と同一のログとは扱わない。

生のクラッシュログ・端末識別子はこのファイルに保存していない。

## ユーザーによる確認

今回の変更を含むビルドで、新規・既存のProjectタスク編集を開き、タスク名・予測時間・日付・メモのキーボードを繰り返し表示／終了する。キーボード表示中に上下スクロール、所有者・タグ選択、メモの括弧入力、完了による保存ができ、停止・クラッシュが再発しないことを確認する。Privateのタスクメモも同様に確認する。

Simulator／実機でのアプリ実行、ビルド配布、本番デプロイは行っていない。
