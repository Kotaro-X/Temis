import { resolveGuildAuthors } from "./guildAuthorService";
import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseApp } from "../sync/firebaseApp";
import type { TemisAIUsage } from "../freemium/temisFreemiumService";
import { getTemisAIUsage } from "../freemium/temisFreemiumService";

export type GuildAIEvidencePost = {
  id: string;
  authorUserId: string;
  authorDisplayName: string;
  authorPhotoUrl?: string | null;
  title: string | null;
  body: string;
  publishedAt: number | null;
  linkDepth?: number;
  linkPath?: string[];
  snippetText?: string;
};

export type GuildAISearchResult = {
  answerText: string;
  citedPostIds: string[];
  evidencePosts: GuildAIEvidencePost[];
  usage: TemisAIUsage;
};

const region = () =>
  process.env.EXPO_PUBLIC_OPENAI_FUNCTION_REGION?.trim() || "asia-northeast1";

export const searchGuildPostsWithAI = async (
  question: string,
  requestId: string,
): Promise<GuildAISearchResult> => {
  const functions = getFunctions(getFirebaseApp(), region());
  const callable = httpsCallable<{ question: string; requestId: string }, GuildAISearchResult>(
    functions,
    "searchGuildPostsWithAI",
    { timeout: 60_000 },
  );
  try {
    // A deployed legacy search endpoint must not bypass the new quota service.
    await getTemisAIUsage();
    const result = (await callable({ question, requestId })).data;
    return { ...result, evidencePosts: await resolveGuildAuthors(result.evidencePosts) };
  } catch (cause) {
    const code = (cause as { code?: string })?.code;
    const messages: Record<string, string> = {
      "functions/unauthenticated": "Temis AIを利用するにはログインしてください。",
      "functions/permission-denied": "Temis AIの利用権限を確認できませんでした。",
      "functions/resource-exhausted": "今週のTemis AI無料枠を使い切りました。次の月曜日にリセットされます。",
      "functions/failed-precondition": "Temis AIの検索索引を準備中です。しばらくしてからお試しください。",
      "functions/aborted": "参照する投稿が更新されました。もう一度検索してください。",
      "functions/deadline-exceeded": "Temis AIの検索がタイムアウトしました。もう一度お試しください。",
    };
    throw new Error(messages[code ?? ""] ?? "Temis AIの検索に失敗しました。しばらくしてからお試しください。");
  }
};
