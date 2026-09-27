import { getFunctions, httpsCallable } from "firebase/functions";

import { getFirebaseApp } from "./sync/firebaseApp";

export type GroundedAnswerEvidence = { key: string; text: string; linkPath?: string[] };

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
};

export const requestOpenAIGroundedAnswer = async (
  request: GroundedAnswerCallableRequest,
  region: string,
): Promise<GroundedAnswerCallableResponse> => {
  const functions = getFunctions(getFirebaseApp(), region);
  const callable = httpsCallable<
    GroundedAnswerCallableRequest,
    GroundedAnswerCallableResponse
  >(functions, "generateGroundedAnswer", { timeout: 60_000 });
  return (await callable(request)).data;
};
