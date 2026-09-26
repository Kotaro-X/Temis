import {
  answerWithCitations,
} from "./answerWithCitations";
import { searchWikiAnswerEvidence } from "./wikiAnswerRetrieval";
import { labelAnswerEvidence, type EvidenceInput } from "./aiEvidence";

type SelectedPeriod =
  | string
  | {
      label?: string;
      from?: string;
      to?: string;
    };

export type AskLocalAIEvidence = EvidenceInput & { key: string };

export type AskLocalAIResult = {
  answerText: string;
  citedEvidence: AskLocalAIEvidence[];
  allEvidence: AskLocalAIEvidence[];
};

const DEFAULT_TOP_K = 15;
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

  const rawEvidence = await searchWikiAnswerEvidence(trimmed, DEFAULT_TOP_K);
  const allEvidence = labelAnswerEvidence(rawEvidence);
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
