import { requireAIConsent, validateConsentReceipt } from './ai/aiConsent';
import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseApp } from "./sync/firebaseApp";

export type OpenAIEmbeddingCallableResponse = {
  model: string;
  embeddings: number[][];
};

type OpenAIEmbeddingCallableRequest = {
  input: string[];
  consentRevision: string;
  userId: string;
};

const FUNCTION_NAME = "createEmbeddings";

export const requestOpenAIEmbeddings = async (
  input: string[],
  region: string,
  expectedUid?: string,
): Promise<OpenAIEmbeddingCallableResponse> => {
  const receipt = await requireAIConsent(false, expectedUid);
  const functions = getFunctions(getFirebaseApp(), region);
  const createEmbeddings = httpsCallable<
    OpenAIEmbeddingCallableRequest,
    OpenAIEmbeddingCallableResponse
  >(functions, FUNCTION_NAME, { timeout: 60_000 });
  const response = await createEmbeddings({ input, consentRevision: receipt.revision, userId: receipt.uid });
  await validateConsentReceipt(receipt);
  return response.data;
};
