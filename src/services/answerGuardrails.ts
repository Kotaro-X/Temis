type EvidenceLike = {
  id?: string;
  snippetText: string;
};

export type EvidenceQualityResult = {
  ok: boolean;
  reason: "ok" | "no_evidence";
  hasStrongSnippet: boolean;
};

export type GuardedAnswerResult = {
  ok: boolean;
  reason: "ok" | "empty" | "advice_language";
  answerText: string;
};

export const ANSWER_GUARDRAIL_DEFAULTS = {
  maxSentences: 6,
  minStrongSnippetChars: 80,
  temperature: 0.1,
  maxTokens: 800,
} as const;

const ADVICE_PATTERN =
  /(べき|してください|したほうが|推奨|おすすめ|must|should)/i;

const META_PATTERN =
  /(読み取れます|確認できます|参照しました|抽出しました|入力から分かります)/;

const normalizeText = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

const splitSentences = (text: string): string[] => {
  const normalized = normalizeText(text);
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

const withSentenceEnding = (text: string): string =>
  /[。.!?！？]$/.test(text) ? text : `${text}。`;

const sanitizeSentence = (sentence: string): string => {
  const trimmed = sentence.trim();
  if (!trimmed) {
    return "";
  }
  const withoutPunctuation = trimmed.replace(/[。.!?！？]+$/g, "");
  return withSentenceEnding(withoutPunctuation);
};

export const evaluateEvidenceQuality = (
  evidence: EvidenceLike[],
): EvidenceQualityResult => {
  if (evidence.length === 0) {
    return { ok: false, reason: "no_evidence", hasStrongSnippet: false };
  }
  const hasStrongSnippet = evidence.some(
    (item) =>
      normalizeText(item.snippetText).length >=
      ANSWER_GUARDRAIL_DEFAULTS.minStrongSnippetChars,
  );
  return { ok: true, reason: "ok", hasStrongSnippet };
};

export const limitAnswerSentences = (
  text: string,
  maxSentences = ANSWER_GUARDRAIL_DEFAULTS.maxSentences,
): string => splitSentences(text).slice(0, maxSentences).join(" ");

export const guardAnswerText = (text: string): GuardedAnswerResult => {
  const limited = normalizeText(limitAnswerSentences(text));
  if (!limited) {
    return { ok: false, reason: "empty", answerText: "" };
  }
  if (ADVICE_PATTERN.test(limited)) {
    return { ok: false, reason: "advice_language", answerText: "" };
  }
  if (META_PATTERN.test(limited)) {
    return { ok: false, reason: "advice_language", answerText: "" };
  }
  const sanitized = splitSentences(limited)
    .map(sanitizeSentence)
    .filter((item) => item.length > 0)
    .join(" ")
    .trim();
  return {
    ok: !!sanitized,
    reason: sanitized ? "ok" : "empty",
    answerText: sanitized,
  };
};

export const extractEvidenceIdsFromText = (text: string): string[] => {
  const matches = text.match(/\bE\d+\b/g) ?? [];
  return Array.from(new Set(matches));
};
