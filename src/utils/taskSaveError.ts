/** Keep the original error visible and offer a next step without promising a fix. */
export function taskSaveErrorMessage(cause: unknown): string {
  const detail = cause && typeof cause === 'object' ? cause as { code?: unknown; message?: unknown } : {};
  const message = typeof detail.message === 'string' && detail.message.trim()
    ? detail.message : typeof cause === 'string' && cause.trim() ? cause : '保存できませんでした。';
  const code = typeof detail.code === 'string' ? detail.code.split('/').pop() : '';
  let advice: string;
  if (/通知設定/.test(message)) {
    advice = 'タスクは保存済みです。通知設定へのアクセス権限を確認して、もう一度保存してください。';
  } else if (/タスクは保存しましたが/.test(message)) {
    advice = 'タスクは保存済みです。一覧を更新して保存内容を確認してください。';
  } else if (code === 'unauthenticated' || /ログイン|アカウントが切り替わ/.test(message)) {
    advice = 'ログイン中のアカウントを確認し、対象のプロジェクトを開き直してください。';
  } else if (/担当者/.test(message)) {
    advice = '担当者を現在のプロジェクトメンバーから選び直して、保存してください。';
  } else if (code === 'permission-denied' || /権限|アクセスできません|共有タスクを作成できません/.test(message)) {
    advice = 'プロジェクトの所有者に、共有タスクが有効か、参加状態とタスクの作成・編集権限を確認してもらってください。';
  } else if (['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(code ?? '') || /network|offline|ネットワーク|通信/i.test(message)) {
    advice = 'インターネット接続を確認してください。通信が戻ったら一覧で保存済みか確認し、未保存の場合はもう一度保存してください。';
  } else if (code === 'resource-exhausted') {
    advice = '利用上限に達している可能性があります。しばらく待ってから再試行し、続く場合はプロジェクトの所有者に確認してください。';
  } else if (/アーカイブ/.test(message)) {
    advice = 'タスクをアーカイブから復元して、もう一度操作してください。';
  } else if (code === 'invalid-argument' || /入力|日付|時刻|見積時間/.test(message)) {
    advice = '上記の内容に合わせて入力を修正し、もう一度保存してください。';
  } else if (code === 'not-found' || /見つかりません|消去済み/.test(message)) {
    advice = '一覧を更新し、プロジェクトやタスクが存在するか確認してから開き直してください。';
  } else {
    advice = '入力内容を控えて一覧を更新し、保存済みか確認してください。解決しない場合は、このエラー内容をプロジェクトの所有者またはサポートに伝えてください。';
  }
  return `${message}\n\n対処方法\n${advice}`;
}
