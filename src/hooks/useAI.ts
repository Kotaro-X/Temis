import { useCallback, useRef, useState } from "react";

import { searchAndGenerateAnswer } from "../ai/aiService";
import type { AIEvidence } from "../types";

const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
const DEFAULT_ANSWER_TIMEOUT_MS = 45_000;

const withTimeout = async <T,>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timeout`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const useAI = (messages: {
  searchError: string;
  searchTimeoutError: string;
  answerError: string;
  answerTimeoutError: string;
}) => {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [allEvidence, setAllEvidence] = useState<AIEvidence[]>([]);
  const [citedEvidenceKeys, setCitedEvidenceKeys] = useState<string[]>([]);
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const lastRunQueryRef = useRef("");
  const requestIdRef = useRef(0);

  const run = useCallback(
    async (nextQuery?: string) => {
      const runQuery = (nextQuery ?? query).trim();
      lastRunQueryRef.current = runQuery;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setSearched(true);
      setAnswerText("");
      setError(null);
      setCitedEvidenceKeys([]);
      setShowAllEvidence(false);

      if (!runQuery) {
        setAllEvidence([]);
        return;
      }

      setSearchLoading(true);
      try {
        const result = await withTimeout(
          searchAndGenerateAnswer(runQuery),
          DEFAULT_SEARCH_TIMEOUT_MS + DEFAULT_ANSWER_TIMEOUT_MS,
          "ai",
        );
        if (requestIdRef.current !== requestId) {
          return;
        }
        setAllEvidence(result.allEvidence);
        setSearchLoading(false);
        if (result.allEvidence.length === 0) {
          return;
        }
        setAnswerLoading(true);
        const normalizedAnswer = await withTimeout(
          Promise.resolve(result.answer),
          DEFAULT_ANSWER_TIMEOUT_MS,
          "answer generation",
        );
        if (requestIdRef.current !== requestId) {
          return;
        }
        if (!normalizedAnswer.answerText) {
          setError(messages.answerError);
        } else {
          setAnswerText(normalizedAnswer.answerText);
        }
        setCitedEvidenceKeys(normalizedAnswer.citedEvidenceKeys);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : String(caughtError);
        setAllEvidence([]);
        setError(
          message.includes("timeout")
            ? message.includes("answer")
              ? messages.answerTimeoutError
              : messages.searchTimeoutError
            : message.includes("answer")
              ? messages.answerError
              : messages.searchError,
        );
      } finally {
        if (requestIdRef.current === requestId) {
          setSearchLoading(false);
          setAnswerLoading(false);
        }
      }
    },
    [messages, query],
  );

  const stopGeneration = useCallback(() => {
    requestIdRef.current += 1;
    setSearchLoading(false);
    setAnswerLoading(false);
  }, []);

  const retryGeneration = useCallback(async () => {
    await run(lastRunQueryRef.current || query);
  }, [query, run]);

  return {
    query,
    setQuery,
    searched,
    searchLoading,
    answerLoading,
    answerText,
    error,
    allEvidence,
    citedEvidenceKeys,
    showAllEvidence,
    setShowAllEvidence,
    run,
    stopGeneration,
    retryGeneration,
  };
};
