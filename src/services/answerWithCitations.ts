import { getLLMProvider } from "./LLMProvider";
import type { LLMProvider } from "./LLMProvider";
import {
  ANSWER_GUARDRAIL_DEFAULTS,
  evaluateEvidenceQuality,
  extractEvidenceIdsFromText,
  guardAnswerText,
  limitAnswerSentences,
} from "./answerGuardrails";
import { checkOllamaConnection, getLLMRuntimeConfig } from "./llmSettings";

export type AnswerEvidence = {
  memoId: string;
  chunkId: string;
  snippetText: string;
  createdAt: number;
  tokensHit?: string[];
  score?: number;
};

export type AnswerWithCitationsResult = {
  answerText: string;
  citedEvidenceKeys: string[];
};

export type LabeledEvidence = AnswerEvidence & {
  evidenceKey: string;
};

type MemoBlock = {
  memoId: string;
  evidenceKeys: string[];
  tokensHit: string[];
  mergedText: string;
  topScore: number;
};

const DEBUG_PREFIX = "[AnswerWithCitations]";
const DEFAULT_TOP_K = 4;
const LOCAL_DEFAULT_TOP_K = 3;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_MAX_TOKENS = 800;
const LOCAL_DEFAULT_MAX_TOKENS = 192;
const LOCAL_DEFAULT_TEMPERATURE = 0.1;
const PROMPT_SNIPPET_MAX_CHARS = 120;
const PROMPT_MEMO_BLOCK_MAX_CHARS = 420;
const MEMO_BLOCK_TEXT_MAX_CHARS = 600;
const MEMO_BLOCK_MAX_COUNT = 4;
const REWRITE_SIMILARITY_THRESHOLD = 0.86;
const PROMPT_ARTIFACT_PATTERN =
  /出力形式を必ず守る|日本語2〜3文|各文は短く自然に完結させる|形式で1行|回答[:：]\s*日本語|根拠[:：]\s*\[E\d+(?:,\s*E\d+)*\]\s*の形式|ANSWER[:：]\s*日本語|CITATIONS[:：]\s*\[E\d+(?:,\s*E\d+)*\]\s*の形式/i;
const FALLBACK_UNKNOWN_TEXT = "情報不足のため見つかりません。";
const OLLAMA_ERROR_TEXT =
  "ローカルLLMに接続できません。Ollamaの起動状態を確認してください。";
const LOCAL_LLM_ERROR_TEXT =
  "ローカルLLMを初期化できません。モデルファイルと設定を確認してください。";

const normalizeTopK = (value: number): number =>
  Math.min(10, Math.max(1, Math.floor(value)));

const normalizeParens = (text: string): string =>
  text.replace(/\uFF08/g, "(").replace(/\uFF09/g, ")");

const sanitizePromptText = (text: string): string =>
  normalizeParens(text).replace(/\s+/g, " ").trim();

const sanitizeQuestionText = (text: string): string => {
  const cleaned = normalizeParens(text).replace(/\s+/g, " ").trim();
  return cleaned || text.trim();
};

const normalizeForSimilarity = (text: string): string =>
  text.replace(/\s+/g, "").replace(/[。.!?！？、,，]/g, "").trim();

const normalizeForRepetition = (text: string): string =>
  text.replace(/\s+/g, "").replace(/[。.!?！？、,，()（）]/g, "").trim();

const toBigramSet = (text: string): Set<string> => {
  const normalized = normalizeForSimilarity(text);
  const set = new Set<string>();
  if (normalized.length < 2) {
    return set;
  }
  for (let i = 0; i < normalized.length - 1; i += 1) {
    set.add(normalized.slice(i, i + 2));
  }
  return set;
};

const diceCoefficient = (left: string, right: string): number => {
  const leftSet = toBigramSet(left);
  const rightSet = toBigramSet(right);
  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  return (2 * intersection) / (leftSet.size + rightSet.size);
};

const countSentences = (text: string): number => {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  const matches = trimmed.match(/[。.!?！？]/g);
  if (matches && matches.length > 0) {
    return matches.length;
  }
  return 1;
};

const splitSentences = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }
  const sentences: string[] = [];
  let buffer = "";
  for (const char of normalized) {
    buffer += char;
    if (/[。.!?！？]/.test(char)) {
      const sentence = buffer.trim();
      if (sentence) {
        sentences.push(sentence);
      }
      buffer = "";
    }
  }
  const tail = buffer.trim();
  if (tail) {
    sentences.push(tail);
  }
  return sentences.length > 0 ? sentences : [normalized];
};

const normalizeForDedupe = (text: string): string =>
  text.replace(/\s+/g, "").replace(/[。.!?！？、,，]/g, "").trim();

const dedupeSentences = (text: string, maxSentences = 4): string => {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) {
    return text.trim();
  }
  const kept: string[] = [];
  const normalizedKept: string[] = [];
  for (const sentence of sentences) {
    const normalized = normalizeForDedupe(sentence);
    if (!normalized) {
      continue;
    }
    const isDuplicate = normalizedKept.some((existing) => {
      if (existing === normalized) {
        return true;
      }
      if (existing.includes(normalized) || normalized.includes(existing)) {
        return true;
      }
      return diceCoefficient(existing, normalized) >= 0.9;
    });
    if (!isDuplicate) {
      kept.push(sentence.trim());
      normalizedKept.push(normalized);
    }
    if (kept.length >= maxSentences) {
      break;
    }
  }
  const result = kept.join(" ").trim();
  return result || text.trim();
};

const isRepeatingChunk = (text: string): boolean => {
  const normalized = normalizeForRepetition(text);
  if (normalized.length < 8) {
    return false;
  }
  const maxUnit = Math.min(6, Math.floor(normalized.length / 2));
  for (let size = 1; size <= maxUnit; size += 1) {
    if (normalized.length % size !== 0) {
      continue;
    }
    const unit = normalized.slice(0, size);
    const repeats = normalized.length / size;
    if (repeats >= 4 && unit.repeat(repeats) === normalized) {
      return true;
    }
  }
  return false;
};

const isRepeatedParenToken = (text: string): boolean => {
  const tokens = text.match(/[（(][^()（）]{1,12}[)）]/g) ?? [];
  if (tokens.length < 4) {
    return false;
  }
  const first = tokens[0];
  if (!tokens.every((token) => token === first)) {
    return false;
  }
  const stripped = text
    .replace(/[（(][^()（）]{1,12}[)）]/g, "")
    .replace(/\s+/g, "")
    .trim();
  return stripped.length <= 4;
};

const isRepetitionOutput = (text: string): boolean =>
  isRepeatingChunk(text) || isRepeatedParenToken(text);

const toPromptEvidence = (
  evidence: AnswerEvidence[],
  topK = DEFAULT_TOP_K,
): LabeledEvidence[] =>
  evidence
    .slice()
    .sort(
      (left, right) =>
        (right.tokensHit?.length ?? 0) - (left.tokensHit?.length ?? 0) ||
        (right.score ?? 0) - (left.score ?? 0) ||
        left.chunkId.localeCompare(right.chunkId),
    )
    .slice(0, normalizeTopK(topK))
    .map((item, index) => ({
      ...item,
      evidenceKey: `E${index + 1}`,
    }));

const debugLog = (message: string): void => {
  console.log(`${DEBUG_PREFIX} ${message}`);
};

const isInsufficientText = (text: string): boolean =>
  /情報不足|見つかりません/.test(text);

const hasPromptArtifact = (text: string): boolean =>
  PROMPT_ARTIFACT_PATTERN.test(text);

const stripMemoLabels = (text: string): string =>
  text
    .replace(
      /[（(]?\s*メモ番号\s*[:：]?\s*メモ?\d+\s*[)）]?/g,
      "",
    )
    .replace(/[（(]\s*メモ\d+\s*[)）]\s*/g, "")
    .replace(/メモ\d+\s*[:：]\s*/g, "")
    .replace(/\[M\d+\]\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const buildMemoBlocks = (evidence: LabeledEvidence[]): MemoBlock[] => {
  if (evidence.length === 0) {
    return [];
  }
  const byMemoId = new Map<
    string,
    { items: LabeledEvidence[]; textSet: Set<string>; texts: string[] }
  >();
  for (const item of evidence) {
    const existing = byMemoId.get(item.memoId) ?? {
      items: [],
      textSet: new Set<string>(),
      texts: [],
    };
    existing.items.push(item);
    const normalizedText = sanitizePromptText(item.snippetText);
    if (normalizedText && !existing.textSet.has(normalizedText)) {
      existing.textSet.add(normalizedText);
      existing.texts.push(normalizedText);
    }
    byMemoId.set(item.memoId, existing);
  }

  const blocks = Array.from(byMemoId.entries()).map(([memoId, value]) => {
    const sortedItems = value.items.slice().sort(
      (left, right) =>
        (right.tokensHit?.length ?? 0) - (left.tokensHit?.length ?? 0) ||
        (right.score ?? 0) - (left.score ?? 0) ||
        left.chunkId.localeCompare(right.chunkId),
    );
    const tokens = Array.from(
      new Set(
        sortedItems.flatMap((item) => item.tokensHit ?? []).filter(Boolean),
      ),
    );
    const textSeed = value.texts.join(" ");
    const mergedText =
      textSeed.length <= MEMO_BLOCK_TEXT_MAX_CHARS
        ? textSeed
        : `${textSeed.slice(0, MEMO_BLOCK_TEXT_MAX_CHARS)}...`;
    return {
      memoId,
      evidenceKeys: sortedItems.map((item) => item.evidenceKey),
      tokensHit: tokens,
      mergedText,
      topScore: sortedItems[0]?.score ?? 0,
    };
  });

  return blocks
    .sort(
      (left, right) =>
        right.tokensHit.length - left.tokensHit.length ||
        right.topScore - left.topScore ||
        left.memoId.localeCompare(right.memoId),
    )
    .slice(0, MEMO_BLOCK_MAX_COUNT);
};

const isMostlyMemoLabels = (text: string): boolean => {
  const labelPattern =
    /[（(]?\s*メモ番号\s*[:：]?\s*メモ?\d+\s*[)）]?|[（(]?\s*メモ\d+\s*[)）]?/g;
  const matches = text.match(labelPattern) ?? [];
  if (matches.length < 3) {
    return false;
  }
  const stripped = text
    .replace(labelPattern, "")
    .replace(/\s+/g, "")
    .trim();
  const memoOnly = matches.join("").replace(/\s+/g, "");
  if (!memoOnly) {
    return false;
  }
  return stripped.length <= Math.max(4, Math.floor(memoOnly.length * 0.25));
};

const isTooLiteralAnswer = (answerText: string, memoBlocks: MemoBlock[]): boolean => {
  if (!answerText.trim() || memoBlocks.length === 0) {
    return false;
  }
  const normalizedAnswer = normalizeForSimilarity(answerText);
  if (!normalizedAnswer) {
    return false;
  }
  return memoBlocks.some((block) => {
    const normalizedMemo = normalizeForSimilarity(block.mergedText);
    if (!normalizedMemo) {
      return false;
    }
    if (
      normalizedMemo.includes(normalizedAnswer) ||
      normalizedAnswer.includes(normalizedMemo)
    ) {
      return true;
    }
    return (
      diceCoefficient(normalizedAnswer, normalizedMemo) >=
      REWRITE_SIMILARITY_THRESHOLD
    );
  });
};

const shouldRewriteAnswer = (
  answerText: string,
  memoBlocks: MemoBlock[],
): boolean => {
  if (!answerText.trim() || memoBlocks.length === 0) {
    return false;
  }
  if (isInsufficientText(answerText)) {
    return false;
  }
  const memoCount = memoBlocks.length;
  const sentenceCount = countSentences(answerText);
  const tooShortForMultiple = memoCount >= 2 && sentenceCount < 2;
  return isTooLiteralAnswer(answerText, memoBlocks) || tooShortForMultiple;
};

const buildRewritePrompt = (
  question: string,
  memoBlocks: MemoBlock[],
  answerText: string,
): string => {
  const memoLines =
    memoBlocks.length === 0
      ? ["(メモなし)"]
      : memoBlocks.map((block) => `- ${block.mergedText}`);
  const sanitizedQuestion = sanitizeQuestionText(question);
  const questionLine = sanitizedQuestion ? `[質問] ${sanitizedQuestion}` : "[質問] (なし)";
  const multiMemo = memoBlocks.length >= 2;
  return [
    "次のメモ内容を要約し、元文の言い回しを避けて書き直してください。",
    "条件:",
    "- 事実の追加や推測は禁止。",
    "- 同じ文面をそのまま出さず、必ず言い換える。",
    "- できるだけ短く（原文の7割以下を目標）。",
    multiMemo ? "- 複数のメモを統合してまとめる。" : "- 1つのメモを簡潔にまとめる。",
    "- 出力は1〜2文のみ。",
    "- 番号や識別子は出さない。",
    "",
    questionLine,
    "[メモ]",
    ...memoLines,
    "[元の回答]",
    answerText.trim(),
    "",
    "出力: 要約文のみ。",
  ].join("\n");
};

const buildEvidenceSummaryAnswer = (evidence: LabeledEvidence[]): string => {
  if (evidence.length === 0) {
    return FALLBACK_UNKNOWN_TEXT;
  }
  const memoBlocks = buildMemoBlocks(evidence);
  const summarySeed = memoBlocks.map((block) => block.mergedText).join(" ");
  if (!summarySeed) {
    return "根拠から読み取れる内容を要約できませんでした。";
  }
  const guarded = guardAnswerText(summarySeed);
  if (guarded.ok && !isInsufficientText(guarded.answerText)) {
    const cleaned = stripMemoLabels(guarded.answerText);
    if (cleaned) {
      return cleaned;
    }
  }
  const limited = limitAnswerSentences(summarySeed).trim();
  if (!limited) {
    return "根拠から読み取れる内容を要約できませんでした。";
  }
  const sanitized = limited
    .replace(/情報不足のため見つかりません。?/g, "")
    .replace(/見つかりません。?/g, "")
    .trim();
  const cleaned = stripMemoLabels(sanitized);
  const deduped = dedupeSentences(cleaned || sanitized);
  return deduped || "根拠から読み取れる内容を要約できませんでした。";
};

const normalizePromptSnippet = (
  text: string,
  maxChars = PROMPT_SNIPPET_MAX_CHARS,
): string => {
  const normalized = sanitizePromptText(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "-";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const normalizeLocalAnswerText = (text: string): string => {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) {
    return "";
  }
  const answerMatch = normalized.match(
    /(?:^|\n)\s*(?:回答|ANSWER)[:：]\s*([\s\S]*?)(?:\n\s*(?:根拠|CITATIONS?)[:：]|$)/i,
  );
  const extracted = answerMatch ? answerMatch[1].trim() : normalized;
  const withoutEvidenceLine = extracted.replace(
    /\n\s*(?:根拠|CITATIONS?)[:：][\s\S]*$/im,
    "",
  );
  const cleaned = withoutEvidenceLine.replace(/\n{2,}/g, "\n").trim();
  if (!cleaned) {
    return "";
  }
  if (/[。.!?！？]$/.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}。`;
};

export const buildAnswerPrompt = (
  question: string,
  evidence: AnswerEvidence[],
  logSummaryText?: string,
): string => {
  const labeled = toPromptEvidence(evidence, DEFAULT_TOP_K);
  const memoBlocks = buildMemoBlocks(labeled);
  const evidenceLines =
    labeled.length === 0
      ? ["(根拠なし)"]
      : labeled.map((item) => {
          const snippet = normalizePromptSnippet(item.snippetText);
          return [
            `[${item.evidenceKey}]`,
            `memoId=${item.memoId}`,
            `chunkId=${item.chunkId}`,
            `createdAt=${item.createdAt}`,
            `score=${item.score ?? 0}`,
            `tokens=${(item.tokensHit ?? []).join(",") || "-"}`,
            `text=${JSON.stringify(snippet)}`,
          ].join(" ");
        });
  const memoBlockLines =
    memoBlocks.length === 0
      ? ["(メモブロックなし)"]
      : memoBlocks.map((block, index) => {
          const blockText = normalizePromptSnippet(
            block.mergedText,
            PROMPT_MEMO_BLOCK_MAX_CHARS,
          );
          return [
            `[M${index + 1}]`,
            `memoId=${block.memoId}`,
            `evidence=${block.evidenceKeys.join(",") || "-"}`,
            `tokens=${block.tokensHit.join(",") || "-"}`,
            `text=${JSON.stringify(blockText)}`,
          ].join(" ");
        });
  const summarySection = logSummaryText?.trim()
    ? `\n[LOG_SUMMARY]\n${logSummaryText.trim()}`
    : "\n[LOG_SUMMARY]\n(なし)";

  return [
    "[SYSTEM]",
    "あなたは根拠制約付きの回答器です。次の制約を必ず守ってください。",
    "1) 根拠にない内容を推測して書かない。",
    "2) 助言・評価・断定をしない（\"〜すべき\"を使わない）。",
    "3) 根拠に含まれないことを断言しない。",
    "4) 根拠が1件以上ある場合は、必ず根拠の内容を要約して回答し、『情報不足』と書かない。",
    "5) 根拠が0件の場合のみ『情報不足のため見つかりません。』と答える。",
    "6) メタ発言は禁止（読み取れます / 確認できます / 参照しました / 抽出しました / 入力から分かります を使わない）。",
    "7) 出力は必ずJSONのみ。キーは answer と citations のみ。",
    "8) citations は実際に使った根拠だけを返す。",
    "9) answer は最大6文。可能なら4〜6文で詳しく書く。",
    "10) EVIDENCE_TOP_K は根拠ID、MEMO_BLOCKS は同一メモの根拠を統合したテキストである。",
    "11) 回答は MEMO_BLOCKS を優先的に要約し、重複を削って統合する。",
    "12) 根拠文をそのまま長くコピペしない（文言の再構成を行う）。",
    "13) 根拠が短文1文でも同じ文面をそのまま出力せず、必ず言い換える。",
    "14) できるだけ短くまとめる（原文より短く）。",
    "15) 番号や識別子は出力しない。",
    "",
    "[OUTPUT_JSON_SCHEMA]",
    '{"answer":"string","citations":["E1"]}',
    "",
    `[QUESTION]\n${sanitizeQuestionText(question)}`,
    "",
    "[EVIDENCE_TOP_K]",
    ...evidenceLines,
    "",
    "[MEMO_BLOCKS]",
    ...memoBlockLines,
    summarySection,
    "",
    "[INSTRUCTION]",
    "質問に関係する点だけを、メモごとの要点を統合して要約してください。",
  ].join("\n");
};

const buildLocalAnswerPrompt = (
  question: string,
  evidence: AnswerEvidence[],
): string => {
  const labeled = toPromptEvidence(evidence, LOCAL_DEFAULT_TOP_K);
  const memoBlocks = buildMemoBlocks(labeled);
  const docs =
    memoBlocks.length === 0
      ? ["DOC[1]: (空)"]
      : memoBlocks.map((block, index) => {
          const docText = normalizePromptSnippet(
            block.mergedText,
            PROMPT_MEMO_BLOCK_MAX_CHARS,
          );
          const evidenceLabel = block.evidenceKeys.join(",") || "-";
          return `DOC[${index + 1}] (evidence:${evidenceLabel}):\n${docText}`;
        });
  return [
    "あなたのタスク: 複数文書（DOC[1]..DOC[n]）を参照し、重複を除いて統合された1つの要約を生成する。",
    "",
    "=== 入力 ===",
    "以下に複数の文書が与えられる。文書の境界は \"DOC[k]:\" で示される。",
    "",
    "=== 手順（必須）===",
    "Step 1) 各DOCから「重要事実/主張」を最大5個だけ抽出する。",
    "- 抽出は短い箇条書きで、原文の言い回しを極力保持する。",
    "- 推測は禁止。文書に書いてあることだけ。",
    "- 抽出結果には必ず [DOCk] を付けて出典を残す。",
    "",
    "Step 2) Step1の抽出結果を統合し、同じ内容は1つにまとめる。",
    "- 競合（矛盾）がある場合は「矛盾」と明記し両方残す。",
    "",
    "Step 3) 統合要約を1つだけ出力する。",
    "- 出力は日本語2〜3文。",
    "- 参照した内容の範囲を逸脱しない。",
    "",
    "=== 出力フォーマット（厳守）===",
    "ANSWER: 日本語2〜3文。",
    "CITATIONS: [E1,E2]。",
    "",
    "=== 禁止事項 ===",
    "- 各DOCの要約を並べるだけの出力",
    "- 長い段落",
    "- 「思う」「かもしれない」「可能性」などの曖昧語",
    "- 文書にない推測",
    "",
    `[質問] ${sanitizeQuestionText(question)}`,
    "",
    ...docs,
  ].join("\n");
};

const stripCodeFence = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
};

type ParsedJsonResult = {
  parsed: boolean;
  answerText: string;
  citedEvidenceKeys: string[];
  branch: "direct" | "brace" | "none";
};

const parseAnswerJson = (raw: string): ParsedJsonResult => {
  const cleaned = stripCodeFence(raw);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const candidates: Array<{ branch: "direct" | "brace"; text: string }> = [
    { branch: "direct", text: cleaned },
  ];
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push({
      branch: "brace",
      text: cleaned.slice(firstBrace, lastBrace + 1),
    });
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.text) as {
        answer?: unknown;
        citations?: unknown;
        answerText?: unknown;
        citedEvidenceKeys?: unknown;
        citedEvidenceIds?: unknown;
      };
      const answerText =
        typeof parsed.answer === "string"
          ? parsed.answer
          : typeof parsed.answerText === "string"
            ? parsed.answerText
            : "";
      const rawCitations = Array.isArray(parsed.citations)
        ? parsed.citations
        : Array.isArray(parsed.citedEvidenceKeys)
          ? parsed.citedEvidenceKeys
          : Array.isArray(parsed.citedEvidenceIds)
            ? parsed.citedEvidenceIds
            : [];
      const citedEvidenceKeys = rawCitations.filter(
        (item): item is string => typeof item === "string",
      );
      return {
        parsed: true,
        answerText: answerText.trim(),
        citedEvidenceKeys,
        branch: candidate.branch,
      };
    } catch {
      continue;
    }
  }

  return {
    parsed: false,
    answerText: "",
    citedEvidenceKeys: [],
    branch: "none",
  };
};

const sanitizeCitations = (
  citations: string[],
  promptEvidence: LabeledEvidence[],
): string[] => {
  const validKeys = new Set(promptEvidence.map((item) => item.evidenceKey));
  return Array.from(new Set(citations.map((item) => item.trim()))).filter((item) =>
    validKeys.has(item),
  );
};

const buildFallbackCitations = (promptEvidence: LabeledEvidence[]): string[] =>
  promptEvidence.slice(0, Math.min(2, promptEvidence.length)).map((item) => item.evidenceKey);

const selectEvidenceByKeys = (
  promptEvidence: LabeledEvidence[],
  citations: string[],
): LabeledEvidence[] => {
  const keySet = new Set(citations);
  const selected = promptEvidence.filter((item) => keySet.has(item.evidenceKey));
  return selected.length > 0 ? selected : promptEvidence;
};

const buildRetrievalOnlyFallback = (
  promptEvidence: LabeledEvidence[],
): AnswerWithCitationsResult => ({
  answerText:
    promptEvidence.length === 0
      ? FALLBACK_UNKNOWN_TEXT
      : buildEvidenceSummaryAnswer(promptEvidence),
  citedEvidenceKeys:
    promptEvidence.length === 0
      ? []
      : buildFallbackCitations(promptEvidence),
});

export const parseLLMJsonOrFallback = (
  raw: string,
  promptEvidence: LabeledEvidence[],
): AnswerWithCitationsResult => {
  const parsed = parseAnswerJson(raw);
  debugLog(`parse branch=${parsed.branch} parsed=${String(parsed.parsed)}`);

  const jsonCitations = sanitizeCitations(parsed.citedEvidenceKeys, promptEvidence);
  const extractedCitations = sanitizeCitations(
    extractEvidenceIdsFromText(raw),
    promptEvidence,
  );
  const citedEvidenceKeys =
    jsonCitations.length > 0
      ? jsonCitations
      : extractedCitations.length > 0
        ? extractedCitations
        : buildFallbackCitations(promptEvidence);
  const summaryEvidence = selectEvidenceByKeys(promptEvidence, citedEvidenceKeys);
  const summaryFallback = buildEvidenceSummaryAnswer(summaryEvidence);

  const rawText = stripCodeFence(raw).trim();
  let answerText = summaryFallback;
  if (parsed.parsed) {
    const seedAnswerText = parsed.answerText || rawText;
    const guarded = guardAnswerText(seedAnswerText);
    if (guarded.ok && !hasPromptArtifact(guarded.answerText)) {
      answerText = stripMemoLabels(guarded.answerText);
    } else if (hasPromptArtifact(seedAnswerText)) {
      debugLog("parse detected prompt artifact -> retrieval fallback");
    }
  } else {
    debugLog("parse fallback uses retrieval summary");
  }

  if (promptEvidence.length > 0 && isInsufficientText(answerText)) {
    answerText = summaryFallback;
  }
  if (!answerText) {
    answerText = summaryFallback;
  }
  if (promptEvidence.length > 0) {
    const cleaned = stripMemoLabels(answerText);
    if (!cleaned || isMostlyMemoLabels(answerText)) {
      debugLog("parse detected memo label output -> retrieval fallback");
      answerText = summaryFallback;
    } else {
      answerText = cleaned;
    }
  }
  if (answerText) {
    answerText = dedupeSentences(answerText);
  }
  if (promptEvidence.length > 0 && isRepetitionOutput(answerText)) {
    debugLog("parse detected repetition output -> retrieval fallback");
    answerText = summaryFallback;
  }

  debugLog(
    `finalize route=${
      parsed.parsed ? "parsed-json" : "raw-fallback"
    } citations=${citedEvidenceKeys.join(",") || "-"}`,
  );

  return {
    answerText,
    citedEvidenceKeys,
  };
};

const parseLocalTextOrFallback = (
  raw: string,
  promptEvidence: LabeledEvidence[],
): AnswerWithCitationsResult => {
  const normalized = normalizeLocalAnswerText(raw);
  const extractedCitations = sanitizeCitations(
    extractEvidenceIdsFromText(raw),
    promptEvidence,
  );
  const citedEvidenceKeys =
    extractedCitations.length > 0
      ? extractedCitations
      : buildFallbackCitations(promptEvidence);
  const summaryEvidence = selectEvidenceByKeys(promptEvidence, citedEvidenceKeys);
  const summaryFallback = buildEvidenceSummaryAnswer(summaryEvidence);
  if (!normalized) {
    debugLog("local parse empty response -> retrieval fallback");
    return {
      answerText: summaryFallback,
      citedEvidenceKeys,
    };
  }
  const guarded = guardAnswerText(normalized);
  let answerText = guarded.ok
    ? stripMemoLabels(guarded.answerText)
    : summaryFallback;
  if (answerText) {
    answerText = dedupeSentences(answerText);
  }
  if (hasPromptArtifact(normalized) || hasPromptArtifact(answerText)) {
    debugLog("local parse detected prompt artifact -> retrieval fallback");
    answerText = summaryFallback;
  }
  if (promptEvidence.length > 0 && extractedCitations.length === 0) {
    debugLog("local parse missing citations -> fallback citations only");
  }
  if (promptEvidence.length > 0 && isInsufficientText(answerText)) {
    answerText = summaryFallback;
  }
  if (!answerText) {
    answerText = summaryFallback;
  }
  if (promptEvidence.length > 0) {
    const cleaned = stripMemoLabels(answerText);
    if (!cleaned || isMostlyMemoLabels(answerText)) {
      debugLog("local parse detected memo label output -> retrieval fallback");
      answerText = summaryFallback;
    } else {
      answerText = cleaned;
    }
  }
  if (promptEvidence.length > 0 && isRepetitionOutput(answerText)) {
    debugLog("local parse detected repetition output -> retrieval fallback");
    answerText = summaryFallback;
  }
  debugLog(
    `local finalize citations=${citedEvidenceKeys.join(",") || "-"} answerLength=${answerText.length}`,
  );
  return {
    answerText,
    citedEvidenceKeys,
  };
};

const rewriteAnswerIfNeeded = async (
  params: {
    answerText: string;
    question: string;
    promptEvidence: LabeledEvidence[];
    citedEvidenceKeys: string[];
    provider: LLMProvider;
    isLocal: boolean;
    localMaxTokens: number;
  },
): Promise<string> => {
  const {
    answerText,
    question,
    promptEvidence,
    citedEvidenceKeys,
    provider,
    isLocal,
    localMaxTokens,
  } = params;
  if (isLocal) {
    return answerText;
  }
  const summaryEvidence = selectEvidenceByKeys(promptEvidence, citedEvidenceKeys);
  const memoBlocks = buildMemoBlocks(summaryEvidence);
  if (!shouldRewriteAnswer(answerText, memoBlocks)) {
    return answerText;
  }
  debugLog(
    `rewrite triggered memoBlocks=${memoBlocks.length} sentenceCount=${countSentences(
      answerText,
    )}`,
  );
  const rewritePrompt = buildRewritePrompt(question, memoBlocks, answerText);
  try {
    const raw = await provider.generate(rewritePrompt, {
      temperature: Math.min(
        isLocal ? LOCAL_DEFAULT_TEMPERATURE : DEFAULT_TEMPERATURE,
        ANSWER_GUARDRAIL_DEFAULTS.temperature,
      ),
      maxTokens: Math.min(
        isLocal ? localMaxTokens : DEFAULT_MAX_TOKENS,
        ANSWER_GUARDRAIL_DEFAULTS.maxTokens,
      ),
      responseFormat: "text",
    });
    const normalized = normalizeLocalAnswerText(raw);
    const guarded = guardAnswerText(normalized);
    if (guarded.ok && !hasPromptArtifact(guarded.answerText)) {
      const cleaned = stripMemoLabels(guarded.answerText);
      if (cleaned && !isInsufficientText(cleaned)) {
        return cleaned;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugLog(`rewrite failed reason=${message}`);
  }
  return answerText;
};

export const answerWithCitations = async (
  question: string,
  evidence: AnswerEvidence[],
  logSummaryText?: string,
  llmProvider?: LLMProvider,
): Promise<AnswerWithCitationsResult> => {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    return {
      answerText: "質問が空です。質問文を入力してください。",
      citedEvidenceKeys: [],
    };
  }

  const provider = llmProvider ?? getLLMProvider();
  const runtimeConfig = getLLMRuntimeConfig();
  const isLocal = runtimeConfig.provider === "local";
  const topK = isLocal ? LOCAL_DEFAULT_TOP_K : DEFAULT_TOP_K;
  const promptEvidence = toPromptEvidence(evidence, topK);
  const evidenceQuality = evaluateEvidenceQuality(promptEvidence);
  if (!evidenceQuality.ok) {
    debugLog("final route=no-evidence");
    return buildRetrievalOnlyFallback(promptEvidence);
  }
  const prompt = isLocal
    ? buildLocalAnswerPrompt(trimmedQuestion, promptEvidence)
    : buildAnswerPrompt(trimmedQuestion, promptEvidence, logSummaryText);
  const head = prompt.slice(0, 500);
  const tail = prompt.length > 500 ? prompt.slice(-500) : prompt;
  debugLog(
    `prompt evidenceCount=${promptEvidence.length} hasE1=${String(
      prompt.includes("[E1]"),
    )} hasE2=${String(prompt.includes("[E2]"))} hasStrongSnippet=${String(
      evidenceQuality.hasStrongSnippet,
    )}`,
  );
  debugLog(`prompt head(500)=\n${head}`);
  debugLog(`prompt tail(500)=\n${tail}`);
  const localMaxTokens = parseNumber(
    process.env.EXPO_PUBLIC_LOCAL_LLM_MAX_TOKENS,
    LOCAL_DEFAULT_MAX_TOKENS,
  );

  try {
    const raw = await provider.generate(prompt, {
      temperature: Math.min(
        isLocal ? LOCAL_DEFAULT_TEMPERATURE : DEFAULT_TEMPERATURE,
        ANSWER_GUARDRAIL_DEFAULTS.temperature,
      ),
      maxTokens: Math.min(
        isLocal ? localMaxTokens : DEFAULT_MAX_TOKENS,
        ANSWER_GUARDRAIL_DEFAULTS.maxTokens,
      ),
      responseFormat: isLocal ? "text" : "json",
    });
    debugLog(`raw response full=\n${raw}`);
    const parsed = isLocal
      ? parseLocalTextOrFallback(raw, promptEvidence)
      : parseLLMJsonOrFallback(raw, promptEvidence);
    const refinedAnswer = await rewriteAnswerIfNeeded({
      answerText: parsed.answerText,
      question: trimmedQuestion,
      promptEvidence,
      citedEvidenceKeys: parsed.citedEvidenceKeys,
      provider,
      isLocal,
      localMaxTokens,
    });
    debugLog(`final route=llm answerLength=${refinedAnswer.length}`);
    return {
      answerText: refinedAnswer,
      citedEvidenceKeys: parsed.citedEvidenceKeys,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugLog(`llm error=${message}`);
    let devDetails = "";
    const config = getLLMRuntimeConfig();
    if (typeof __DEV__ === "boolean" && __DEV__) {
      if (config.provider === "ollama") {
        const check = await checkOllamaConnection(config);
        devDetails = `\nbaseUrl=${config.ollamaBaseUrl}\nmodel=${config.ollamaModel}\nreason=${check.reason ?? "unknown"}\ndetail=${check.detail ?? message}`;
        debugLog(
          `connection diagnostic baseUrl=${config.ollamaBaseUrl} model=${config.ollamaModel} reason=${check.reason ?? "unknown"}`,
        );
      } else {
        devDetails = `\ndetail=${message}`;
      }
    }
    debugLog("final route=llm-error-connection");
    const baseText =
      config.provider === "ollama" ? OLLAMA_ERROR_TEXT : LOCAL_LLM_ERROR_TEXT;
    return {
      answerText: `${baseText}${devDetails}`,
      citedEvidenceKeys: buildFallbackCitations(promptEvidence),
    };
  }
};
