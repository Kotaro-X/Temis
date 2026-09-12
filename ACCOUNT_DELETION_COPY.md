# Temis Account Deletion Copy / アカウント削除表示文言

Ported v1 copy, pending v2 release review. Accounts with Guild, Project, or Collaboration records currently stop before deletion; shared-data deletion is a release gate.

## 日本語

### 入口

- セクション名: `アカウント`
- 操作名: `アカウントを削除`
- 補足: `クラウド上のアカウントと同期データを完全に削除します。`

### 確認画面

- タイトル: `アカウントを削除しますか？`
- 本文:

  `削除を確定すると、Temisアカウント、クラウド同期したタスク・ToDo・メモ・タグなどのデータ、クラウド上のアクセス設定、購入に紐づくアカウント識別情報が削除されます。障害診断レポートの削除反映には通常24時間程度かかる場合があります。この操作は取り消せません。`

- ローカルデータの選択:

  - ラベル: `この端末のローカルデータも削除する`
  - 既定値: `オン`
  - 補足: `オフにすると、この端末にだけ保存されているデータは残り、アカウントなしで引き続き利用できます。別の端末にあるローカルデータは、その端末で削除するかアプリを削除してください。`

- 定期購入の注意:

  `アカウントを削除しても、Appleで購入した定期購入は自動的に解約されません。iPhoneまたはiPadの「設定」>「[あなたの名前]」>「サブスクリプション」、またはApp Storeのアカウント設定から解約してください。`

- ボタン:

  - 戻る: `キャンセル`
  - 進む: `削除内容を確認する`

### 最終確認

- タイトル: `この操作は取り消せません`
- 本文: `上記のアカウントとクラウドデータを削除します。`
- 実行ボタン: `アカウントを完全に削除`

### 完了

- タイトル: `アカウントを削除しました`
- 本文: `クラウド上のアカウントと対象データを削除しました。障害診断レポートの削除反映には通常24時間程度かかる場合があります。定期購入がある場合は、Appleのサブスクリプション設定で別途解約してください。`

## English

### Entry point

- Section: `Account`
- Action: `Delete Account`
- Caption: `Permanently delete your cloud account and synced data.`

### Confirmation

- Title: `Delete your account?`
- Body:

  `When you confirm, your Temis account, cloud-synced tasks, to-dos, memos, tags, cloud access settings, and purchase-related account identifiers will be deleted. Diagnostic-report deletion can take approximately 24 hours to take effect. This cannot be undone.`

- Local-data option:

  - Label: `Also delete local data on this device`
  - Default: `On`
  - Caption: `If you turn this off, data stored only on this device remains and you can continue using Temis without an account. Delete local data on any other device from that device or by removing the App.`

- Subscription notice:

  `Deleting your account does not automatically cancel an Apple subscription. Cancel it in Settings > [your name] > Subscriptions on iPhone or iPad, or in your App Store account settings.`

- Buttons:

  - Back: `Cancel`
  - Continue: `Review deletion`

### Final confirmation

- Title: `This cannot be undone`
- Body: `Delete the account and cloud data described above.`
- Action: `Permanently Delete Account`

### Completion

- Title: `Account deleted`
- Body: `Your cloud account and applicable data have been deleted. Diagnostic-report deletion can take approximately 24 hours to take effect. If you have a subscription, cancel it separately in Apple subscription settings.`
