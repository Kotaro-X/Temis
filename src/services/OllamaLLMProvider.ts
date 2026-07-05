import { LLMGenerateOptions, LLMProvider } from "./LLMProvider";

type OllamaGenerateResponse = {
  response?: unknown;
  error?: unknown;
};

export type OllamaLLMProviderOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.1:8b";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 0;

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

class OllamaRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export class OllamaLLMProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: OllamaLLMProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.min(
      1,
      Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES)),
    );
  }

  generate = async (
    prompt: string,
    options?: LLMGenerateOptions,
  ): Promise<string> => {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: false,
    };
    const modelOptions: Record<string, unknown> = {};
    if (typeof options?.temperature === "number") {
      modelOptions.temperature = options.temperature;
    }
    if (typeof options?.maxTokens === "number") {
      modelOptions.num_predict = Math.max(1, Math.floor(options.maxTokens));
    }
    if (Object.keys(modelOptions).length > 0) {
      body.options = modelOptions;
    }
    if (options?.responseFormat === "json") {
      body.format = "json";
    }
    const response = await this.postJsonWithRetry<OllamaGenerateResponse>(
      "/api/generate",
      body,
    );
    if (typeof response.error === "string" && response.error.trim()) {
      throw new Error(`Ollama LLM error: ${response.error}`);
    }
    if (typeof response.response !== "string") {
      throw new Error("Ollama LLM response format is invalid.");
    }
    return response.response.trim();
  };

  private async postJsonWithRetry<TResponse>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<TResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.postJson<TResponse>(path, body);
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof OllamaRequestError ? error.retryable : false;
        if (!retryable || attempt >= this.maxRetries) {
          throw error;
        }
        await this.sleep(250);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Ollama LLM request failed for unknown reason.");
  }

  private async postJson<TResponse>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new OllamaRequestError(
          `Ollama LLM request failed (${response.status} ${response.statusText}): ${errorText}`,
          response.status >= 500 || response.status === 429,
        );
      }
      return (await response.json()) as TResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new OllamaRequestError(
          `Ollama LLM request timed out after ${this.timeoutMs}ms (model=${this.model}).`,
          true,
        );
      }
      if (error instanceof OllamaRequestError) {
        throw error;
      }
      if (error instanceof Error) {
        const retryable = error instanceof TypeError;
        throw new OllamaRequestError(
          `Ollama LLM network error: ${error.message}`,
          retryable,
        );
      }
      throw new OllamaRequestError("Ollama LLM request failed.", false);
    } finally {
      clearTimeout(timeout);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
