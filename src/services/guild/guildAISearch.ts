import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseApp } from "../sync/firebaseApp";

export type GuildAIEvidencePost = {
  id: string;
  authorUserId: string;
  authorDisplayName: string;
  title: string | null;
  body: string;
  publishedAt: number | null;
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
  return (await callable({ question })).data;
};
