# Commonsの投稿者参照と元メモの一元管理

## 表示と編集

Commons一覧・詳細・AI根拠の表示名と写真は、`authorUserId` から `guildAuthors/{uid}` を参照する。ここには `displayName`、`photoUrl`、`deleted` だけを保存し、プロフィールの非公開項目を含めない。投稿内の古い写真URLへのフォールバックは行わない。情報が未設定・取得失敗なら人型アイコン、退会済みなら匿名表示とする。プロフィール同期と退会処理が投影を更新し、退会済みの投影を古いイベントが復元しない。

編集・公開・非公開・再公開は元メモ詳細へ統一。Commonsの編集操作は元メモへ移動する。元メモの保存後、タイトル・本文・本文のハッシュタグを反映する。再公開でもCommonsの内容を元メモへ書き戻さない。公開済み投稿の初回投稿日時とモデレーションは保持する。非公開投稿は内容を更新しても自動再公開しない。空本文・200文字を超えるタイトル・900KBを超える公開内容は反映失敗を表示し、ローカルメモは保持する。

## 専用同期とAPI

`persistAndEnqueueSyncEnvelope` がローカルのメモ変更を検出し、通常の有料クラウド同期とは別の `commons-publication:v1:{UID}` に登録する。投稿との関連があるメモだけを登録し、初回公開は専用操作で関連を作成する。ログイン・起動・復帰・メモ詳細で既存投稿と元メモを関連付ける。旧形式の裸のNote IDと `note:`、探究の `tankyu:`、タスクメモIDを扱う。元メモが取得できれば既存Commonsのコピーより優先する。元メモ不在では推測で上書きせず、保存された削除記録がある場合だけ非公開化する。

`updateGuildPublication` callableの入力は、`userId`、`sourceId`、`operation`（sync/publish/unpublish/delete）、`title`、`body`、`version`（updatedAt/deviceId）。初回公開はscope/type/projectIdも送る。応答は本人の関連投稿とサーバーrevision。認証UIDがuserIdと一致することを確認し、所有者だけを更新する。Projectの内容編集・公開には既存のメンバー役割と無料選択／Plusアクセスを確認する。元の権限を失っても、自分の投稿の非公開化は可能。投影が退会済みなら更新しない。

`guildPublicationStates/{SHA256(UID + sourceId)}` はサーバー専用。世代比較と関連投稿の更新をトランザクションにまとめ、古い要求を拒否する。同じミリ秒のローカル編集にも異なる世代を付け、再試行で旧内容を復元しない。初回公開の同時要求は同じ投稿へ収束し、既存の同じ元メモの重複投稿はまとめて更新する。1メモに400件を超える関連投稿がある場合は更新を拒否して運営への問い合わせを案内する。

失敗した要求は保持し、通信失敗は最大5分まで間隔を延ばして再試行する。入力不備・権限喪失・世代競合は次の編集または本人の再試行まで自動送信を止める。アカウント切替時は別UIDの要求を送信／反映しない。削除・非公開操作には新しい私的な下書き本文を送信しない。メモ詳細で反映待ち・反映失敗・反映済みを表示する。

## 移行と本番反映

`backfill-guild-authors.cjs --project=temis-c05aa` は読み取り専用dry-run、`--apply` が適用。既存Firebase CLIのログインをOAuth2対応Firestoreクライアントで使用し、認証情報やプロフィール値は出力しない。100件ごとに走査し、1件ずつ最新プロフィールをトランザクションで確認する。中断後も再実行可能。通常のクラウド同期から取得できない端末内の元メモはサーバー移行では書き換えず、新クライアントが本人の端末で関連付ける。

対象はFirestore Rules、updateGuildPublication、syncProfileIdentity、deleteAccountと投稿者情報の移行だけ。Storage Rules・他のFunctions・料金プラン・旧クライアントの停止は変更しない。追加複合インデックスは不要（既存の作者一覧と単一フィールドのsource.memoId検索を使用）。

## 検証

単体テスト253/253、Firestore・Storage Rules／バックエンド連携32/32、型チェック、iOS Hermes export、差分チェックが成功。変更ファイルのlintはエラーなし。MemoDetailScreenのHooks依存の警告3件は変更前と同一。

Simulator・実機は起動していない。新ビルドで、過去投稿の写真変更／削除・表示名、Memos一覧から開いたメモ詳細の編集とCommons反映、非公開と再公開、オフライン編集後の復帰、別アカウント表示、元メモ削除を確認する。バックエンドの反映だけでは、新しいUIと専用キューは既存配布ビルドへ入らない。Release／TestFlight／App Store配布は別工程。

## 本番反映結果（2026-10-06 JST）

限定dry-run後、Firestore Rulesと3つのFunctionsをデプロイ。updateGuildPublication、syncProfileIdentity、deleteAccountは本番APIで全てACTIVE。公開Firestore Rulesを読み戻し、検証済みソースとの完全一致を確認。Storage Rulesも以前の反映済み内容を維持している。

投稿者情報の移行はdry-runで5件を確認し、5件へ適用。反映後の再実行dry-runは scanned=5 / changed=0 / orphaned=0。端末内の元メモに基づく既存投稿の内容統合は、新ビルドで本人がログイン・復帰・元メモ詳細を開いた時点に実行する。
