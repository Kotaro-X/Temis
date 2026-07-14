export type EmbeddingJobStatus = "pending" | "processing" | "completed" | "failed";

export type EmbeddingJobSnapshot = {
  status: EmbeddingJobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: number;
  lastError: string | null;
};

export const EMBEDDING_RETRY_BASE_DELAY_MS = 30_000;

export const resolveRetryDelayMs = (attempts: number): number => {
  const exponent = Math.min(Math.max(attempts - 1, 0), 6);
  return EMBEDDING_RETRY_BASE_DELAY_MS * 2 ** exponent;
};

export const canRunEmbeddingJob = (
  job: EmbeddingJobSnapshot,
  now: number,
): boolean =>
  (job.status === "pending" || job.status === "failed") &&
  job.attempts < job.maxAttempts &&
  job.nextRunAt <= now;

export const markEmbeddingJobFailed = (
  job: EmbeddingJobSnapshot,
  message: string,
  now: number,
): EmbeddingJobSnapshot => {
  const nextRunAt = now + resolveRetryDelayMs(job.attempts);
  return {
    ...job,
    status: "failed",
    nextRunAt,
    lastError: message,
  };
};

export const shouldCompleteEmbeddingJob = (
  remainingChunks: number,
): boolean => remainingChunks === 0;
