type WaitForResolvedValueOptions = {
  attempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

const defaultSleep = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

export const waitForResolvedValue = async <T>(
  resolveValue: () => Promise<T | null>,
  options: WaitForResolvedValueOptions = {},
): Promise<T | null> => {
  const attempts = Math.max(1, Math.trunc(options.attempts ?? 4));
  const delayMs = Math.max(0, Math.trunc(options.delayMs ?? 400));
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await resolveValue();
      if (value !== null) {
        return value;
      }
      lastError = null;
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
};
