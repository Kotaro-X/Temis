const STAGES: Record<string, string> = {
  invitations: "招待履歴", profile: "プロフィール", cloud_data: "クラウドデータ",
  subscription_access: "クラウド利用権", firebase_auth: "Firebaseアカウント",
};

export const accountDeletionErrorMessage = (error: unknown): string => {
  const value = error as { code?: string; details?: { stage?: string; reason?: string; completedStages?: string[] } } | null;
  if (value?.code === "ERR_REQUEST_CANCELED") return "Appleでの確認をキャンセルしました。今回の削除要求は送信していません。";
  const details = value?.details;
  if (details?.stage === "shared_data") {
    return "Guild・プロジェクト・共有データが残っているため削除を開始できません。アカウント設定の「共有データを確認・整理する」から整理後、もう一度削除してください。アカウントとデータは削除していません。";
  }
  if (details?.stage?.startsWith("apple_")) {
    const reason = details.reason === "configuration" ? "Apple連携の設定に問題があります。運営にお知らせください。"
      : details.reason === "account_mismatch" ? "ログイン中のアカウントと同じApple Accountを選択してください。"
      : details.reason === "revocation" ? "Apple連携の解除に失敗しました。接続を確認し、削除を再試行してください。"
      : "Appleでの本人確認を完了できませんでした。削除を再試行してください。";
    return `${reason} Firebaseの削除処理は開始していません。`;
  }
  if (details?.stage && STAGES[details.stage]) {
    const completed = (details.completedStages ?? []).filter((stage) => STAGES[stage]).map((stage) => STAGES[stage]);
    return `${STAGES[details.stage]}の削除に失敗しました。この段階のデータは一部削除されている可能性があります。${completed.length ? `削除済み：${completed.join("・")}。` : "主要データの削除は未完了です。"}${details.reason === "configuration" ? "サーバー設定の修正が必要です。" : "削除を再試行してください。"} 自動同期は停止しています。`;
  }
  // Never show server exception text, auth tokens or native SDK payloads.
  return "削除結果を確認できませんでした。一部削除済みの可能性があります。自動同期は停止しています。接続を確認し、アカウント削除を再試行してください。";
};

export const assertAccountDeleted = (result: unknown): void => {
  if (!result || typeof result !== "object" || !("deleted" in result) || result.deleted !== true) {
    throw new Error("Deletion not confirmed");
  }
};
