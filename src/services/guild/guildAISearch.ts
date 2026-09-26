import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseApp } from "../sync/firebaseApp";

export type GuildAIEvidencePost = {
  id: string;
  authorUserId: string;
  authorDisplayName: string;
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
};

const region = () =>
  process.env.EXPO_PUBLIC_OPENAI_FUNCTION_REGION?.trim() || "asia-northeast1";

export const searchGuildPostsWithAI = async (
  question: string,
): Promise<GuildAISearchResult> => {
  const functions = getFunctions(getFirebaseApp(), region());
  const callable = httpsCallable<{ question: string }, GuildAISearchResult>(
    functions,
    "searchGuildPostsWithAI",
    { timeout: 60_000 },
  );
  try {
    return (await callable({ question })).data;
  } catch (cause) {
    const code = (cause as { code?: string })?.code;
    const messages: Record<string, string> = {
      "functions/unauthenticated": "Temis AIを利用するにはログインしてください。",
      "functions/permission-denied": "CommonsのTemis AIはTemis Plusで利用できます。",
      "functions/failed-precondition": "Temis AIの検索索引を準備中です。しばらくしてからお試しください。",
      "functions/aborted": "参照する投稿が更新されました。もう一度検索してください。",
      "functions/resource-exhausted": "Temis AIが混み合っています。しばらくしてからお試しください。",
      "functions/deadline-exceeded": "Temis AIの検索がタイムアウトしました。もう一度お試しください。",
    };
    throw new Error(messages[code ?? ""] ?? "Temis AIの検索に失敗しました。しばらくしてからお試しください。");
  }
};
