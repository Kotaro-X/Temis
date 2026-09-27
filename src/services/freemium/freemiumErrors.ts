export class TemisUsageError extends Error {
  constructor(message: string) { super(message); this.name = "TemisUsageError"; }
}

export const aiUsageErrorMessage = (cause: unknown): string => {
  const code = (cause as { code?: string })?.code;
  if (code === "functions/resource-exhausted") return "今週のTemis AI無料枠を使い切りました。次の月曜日00:00にリセットされます。";
  if (code === "functions/unauthenticated") return "Temis AIを利用するにはログインしてください。";
  return "Temis AIの利用状態を確認できませんでした。しばらくしてから再試行してください。";
};

export const projectInvitationErrorMessage = (cause: unknown): string => {
  const error = cause as { code?: string; details?: { reason?: string } };
  if (error?.details?.reason === "invitation_missing") return "この招待は削除されています。招待者に再送を依頼してください。";
  if (error?.details?.reason === "invitation_expired") return "この招待は有効期限が切れています。招待者に再送を依頼してください。";
  if (error?.details?.reason === "project_missing") return "このプロジェクトは現在利用できません。";
  if (error?.code === "functions/resource-exhausted") return "無料プランで利用できるプロジェクトは1件までです。Projectsで所属を整理するか、Temis Plusをご利用ください。";
  if (error?.code === "functions/not-found") return "招待サービスを利用できません。しばらくしてから再試行してください。";
  if (error?.code === "functions/unauthenticated") return "招待に応答するにはログインしてください。";
  if (error?.code === "functions/permission-denied") return "この招待には応答できません。アカウントと招待の状態を確認してください。";
  return "招待への応答に失敗しました。通信状態を確認して再試行してください。";
};
