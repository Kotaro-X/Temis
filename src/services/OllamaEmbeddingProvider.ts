import { EmbeddingBatch, EmbeddingProvider, EmbeddingVector } from "./EmbeddingProvider";

type OllamaEmbedResponse = {
  embedding?: unknown;
  embeddings?: unknown;
};

export type OllamaEmbeddingProviderOptions = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  maxInputChars?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_INPUT_CHARS = 2_000;

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const parseVector = (value: unknown): EmbeddingVector | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const vector = value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item),
  );
  if (vector.length !== value.length) {
    return null;
  }
  return vector;
};

const parseVectors = (value: unknown): EmbeddingBatch | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const vectors: EmbeddingBatch = [];
  for (const item of value) {
    const vector = parseVector(item);
    if (!vector) {
      return null;
    }
    vectors.push(vector);
  }
  return vectors;
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxInputChars: number;
  private dim = 0;

  constructor(options: OllamaEmbeddingProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  }

  getDim = (): number => this.dim;

  getModel = (): string => this.model;

  getModelVersion = (): string => this.model;

  embed = async (text: string): Promise<EmbeddingVector> => {
    const embeddings = await this.embedBatch([text]);
    const first = embeddings[0];
    if (!first) {
      throw new Error("Ollama embedding response did not include a vector.");
    }
    return first;
  };

  embedBatch = async (texts: string[]): Promise<EmbeddingBatch> => {
    if (texts.length === 0) {
      return [];
    }
    const inputs = texts.map((text) => this.normalizeInput(text));
    const response = await this.requestEmbed(inputs);
    const embeddings = this.extractEmbeddings(response);
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Ollama embedding response count mismatch. expected=${texts.length}, actual=${embeddings.length}`,
      );
    }
    this.validateDimension(embeddings);
    return embeddings;
  };

  private normalizeInput(text: string): string {
    const normalized = text.trim();
    if (!normalized) {
      return " ";
    }
    if (normalized.length <= this.maxInputChars) {
      return normalized;
    }
    return normalized.slice(0, this.maxInputChars);
  }

  private validateDimension(embeddings: EmbeddingBatch): void {
    for (const vector of embeddings) {
      if (this.dim === 0) {
        this.dim = vector.length;
      } else if (vector.length !== this.dim) {
        throw new Error(
          `Ollama embedding dimension mismatch. expected=${this.dim}, actual=${vector.length}`,
        );
      }
    }
  }

  private async requestEmbed(inputs: string[]): Promise<OllamaEmbedResponse> {
    const body = {
      model: this.model,
      input: inputs.length === 1 ? inputs[0] : inputs,
    };
    return this.postJson<OllamaEmbedResponse>("/api/embed", body);
  }

  private extractEmbeddings(response: OllamaEmbedResponse): EmbeddingBatch {
    const batch = parseVectors(response.embeddings);
    if (batch) {
      return batch;
    }
    const single = parseVector(response.embedding);
    if (single) {
      return [single];
    }
    throw new Error("Ollama embedding response format is invalid.");
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
        throw new Error(
          `Ollama request failed (${response.status} ${response.statusText}): ${errorText}`,
        );
      }
      return (await response.json()) as TResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Ollama request timed out after ${this.timeoutMs}ms (model=${this.model}).`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
