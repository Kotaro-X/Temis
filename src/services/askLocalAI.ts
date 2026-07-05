import {
  AnswerEvidence,
  answerWithCitations,
} from "./answerWithCitations";
import { hybridSearch } from "./hybridSearch";

type SelectedPeriod =
  | string
  | {
      label?: string;
      from?: string;
      to?: string;
    };

export type AskLocalAIEvidence = {
  key: string;
  memoId: string;
  chunkId: string;
  snippetText: string;
  createdAt: number;
  tokensHit?: string[];
  score?: number;
};

export type AskLocalAIResult = {
  answerText: string;
  citedEvidence: AskLocalAIEvidence[];
  allEvidence: AskLocalAIEvidence[];
};

const DEFAULT_TOP_K = 8;
const NOT_FOUND_TEXT = "該当メモが見つかりません。";

const toDateLabel = (timestamp: number): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toISOString().slice(0, 10);
};

const normalizePeriod = (value?: SelectedPeriod): string | null => {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  const label = value.label?.trim();
  if (label) {
    return label;
  }
  const from = value.from?.trim();
  const to = value.to?.trim();
  if (from && to) {
    return `${from}..${to}`;
  }
  return from || to || null;
};

const labelEvidence = (evidence: AnswerEvidence[]): AskLocalAIEvidence[] =>
  evidence
    .slice()
    .sort(
      (left, right) =>
        (right.tokensHit?.length ?? 0) - (left.tokensHit?.length ?? 0) ||
        (right.score ?? 0) - (left.score ?? 0) ||
        left.chunkId.localeCompare(right.chunkId),
    )
    .slice(0, DEFAULT_TOP_K)
    .map((item, index) => ({
      key: `E${index + 1}`,
      memoId: item.memoId,
      chunkId: item.chunkId,
      snippetText: item.snippetText,
      createdAt: item.createdAt,
      tokensHit: item.tokensHit,
      score: item.score,
    }));

const buildLogSummaryText = (
  evidence: AskLocalAIEvidence[],
  selectedTag?: string,
  selectedPeriod?: SelectedPeriod,
): string | undefined => {
  const summaryItems: string[] = [];
  const tag = selectedTag?.trim();
  const period = normalizePeriod(selectedPeriod);
  if (tag) {
    summaryItems.push(`tag=${tag}`);
  }
  if (period) {
    summaryItems.push(`period=${period}`);
  }
  if (evidence.length > 0) {
    const dates = evidence.map((item) => item.createdAt).sort((a, b) => a - b);
    summaryItems.push(`evidence=${evidence.length}件`);
    summaryItems.push(`range=${toDateLabel(dates[0])}..${toDateLabel(dates[dates.length - 1])}`);
  }
  if (summaryItems.length === 0) {
    return undefined;
  }
  return `検索集計: ${summaryItems.join(" / ")}`;
};

export const askLocalAI = async (
  question: string,
  selectedTag?: string,
  selectedPeriod?: SelectedPeriod,
): Promise<AskLocalAIResult> => {
  const trimmed = question.trim();
  if (!trimmed) {
    return {
      answerText: "",
      citedEvidence: [],
      allEvidence: [],
    };
  }

  const rawEvidence = await hybridSearch(trimmed, {
    topK: DEFAULT_TOP_K,
    topN: DEFAULT_TOP_K,
  });
  const allEvidence = labelEvidence(rawEvidence);
  if (allEvidence.length === 0) {
    return {
      answerText: NOT_FOUND_TEXT,
      citedEvidence: [],
      allEvidence: [],
    };
  }

  const logSummaryText = buildLogSummaryText(
    allEvidence,
    selectedTag,
    selectedPeriod,
  );
  const answered = await answerWithCitations(trimmed, allEvidence, logSummaryText);
  const citedKeySet = new Set(answered.citedEvidenceKeys);
  const citedEvidence = allEvidence.filter((item) => citedKeySet.has(item.key));

  return {
    answerText: answered.answerText,
    citedEvidence,
    allEvidence,
  };
};
