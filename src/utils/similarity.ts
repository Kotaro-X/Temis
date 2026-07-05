export const cosineSimilarity = (
  left: number[],
  right: number[],
): number | null => {
  if (left.length === 0 || right.length === 0) {
    return null;
  }
  if (left.length !== right.length) {
    return null;
  }
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    dot += a * b;
    normLeft += a * a;
    normRight += b * b;
  }
  if (normLeft === 0 || normRight === 0) {
    return null;
  }
  return dot / Math.sqrt(normLeft * normRight);
};

export const stableTopK = <T>(
  values: T[],
  k: number,
  compare: (left: T, right: T) => number,
): T[] => {
  const normalizedK = Math.max(1, Math.floor(k));
  return values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => {
      const score = compare(left.value, right.value);
      if (score !== 0) {
        return score;
      }
      return left.index - right.index;
    })
    .slice(0, normalizedK)
    .map((entry) => entry.value);
};
