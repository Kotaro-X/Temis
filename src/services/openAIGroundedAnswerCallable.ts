import { requireAIConsent, validateConsentReceipt } from './ai/aiConsent';
import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseApp } from "./sync/firebaseApp";

export type GroundedAnswerEvidence = { key: string; text: string; memoId?: string; linkPath?: string[] };

export type GroundedAnswerCallableResponse = {
  model: string;
  answerText: string;
  citedEvidenceKeys: string[];
};

type GroundedAnswerCallableRequest = {
  question: string;
  evidence: GroundedAnswerEvidence[];
  logSummaryText?: string;
  requestId?: string;
  consentRevision?: string;
  userId?: string;
};

export const requestOpenAIGroundedAnswer = async (
  request: GroundedAnswerCallableRequest,
  region: string,
): Promise<GroundedAnswerCallableResponse> => {
  const receipt = await requireAIConsent(false, request.userId);
  const functions = getFunctions(getFirebaseApp(), region);
  const callable = httpsCallable<
    GroundedAnswerCallableRequest,
    GroundedAnswerCallableResponse
  >(functions, "generateGroundedAnswer", { timeout: 60_000 });
  const response = (await callable({ ...request, consentRevision: receipt.revision, userId: receipt.uid })).data;
  await validateConsentReceipt(receipt);
  return response;
};
