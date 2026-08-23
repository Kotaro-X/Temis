import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseApp } from "./sync/firebaseApp";

export type OpenAIEmbeddingCallableResponse = {
  model: string;
  embeddings: number[][];
};

type OpenAIEmbeddingCallableRequest = {
  input: string[];
};

const FUNCTION_NAME = "createEmbeddings";

export const requestOpenAIEmbeddings = async (
  input: string[],
  region: string,
): Promise<OpenAIEmbeddingCallableResponse> => {
  const functions = getFunctions(getFirebaseApp(), region);
  const createEmbeddings = httpsCallable<
    OpenAIEmbeddingCallableRequest,
    OpenAIEmbeddingCallableResponse
  >(functions, FUNCTION_NAME, { timeout: 60_000 });
  const response = await createEmbeddings({ input });
  return response.data;
};
