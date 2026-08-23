import type {
  EmbeddingBatch,
  EmbeddingProvider,
  EmbeddingVector,
} from "./EmbeddingProvider";

export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

export class OpenAIEmbeddingAuthenticationError extends Error {
  constructor() {
    super("Sign in is required to create OpenAI memo search embeddings.");
    this.name = "OpenAIEmbeddingAuthenticationError";
  }
}

export type OpenAIEmbeddingProviderOptions = {
  region: string;
  maxInputChars?: number;
  requestEmbeddings: (
    input: string[],
    region: string,
  ) => Promise<{ model: string; embeddings: number[][] }>;
};

const DEFAULT_MAX_INPUT_CHARS = 4_000;

const isEmbeddingVector = (value: unknown): value is EmbeddingVector =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === "number" && Number.isFinite(item));

const isCallableAuthenticationError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "functions/unauthenticated";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly region: string;
  private readonly maxInputChars: number;
  private readonly requestEmbeddings: OpenAIEmbeddingProviderOptions["requestEmbeddings"];
  private dim = 0;

  constructor(options: OpenAIEmbeddingProviderOptions) {
    this.region = options.region;
    this.maxInputChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
    this.requestEmbeddings = options.requestEmbeddings;
  }

  getDim = (): number => this.dim;

  getModel = (): string => OPENAI_EMBEDDING_MODEL;

  getModelVersion = (): string => OPENAI_EMBEDDING_MODEL;

  embed = async (text: string): Promise<EmbeddingVector> => {
    const embeddings = await this.embedBatch([text]);
    const first = embeddings[0];
    if (!first) {
      throw new Error("OpenAI embedding response did not include a vector.");
    }
    return first;
  };

  embedBatch = async (texts: string[]): Promise<EmbeddingBatch> => {
    if (texts.length === 0) {
      return [];
    }
    let response: { model: string; embeddings: number[][] };
    try {
      response = await this.requestEmbeddings(
        texts.map((text) => this.normalizeInput(text)),
        this.region,
      );
    } catch (error) {
      if (isCallableAuthenticationError(error)) {
        throw new OpenAIEmbeddingAuthenticationError();
      }
      throw error;
    }
    if (response.model !== this.getModel()) {
      throw new Error("OpenAI embedding response used an unexpected model.");
    }
    if (
      response.embeddings.length !== texts.length ||
      !response.embeddings.every(isEmbeddingVector)
    ) {
      throw new Error("OpenAI embedding response was invalid.");
    }
    this.validateDimension(response.embeddings);
    return response.embeddings;
  };

  private normalizeInput(text: string): string {
    const normalized = text.trim();
    if (!normalized) {
      throw new Error("OpenAI cannot create an embedding for empty text.");
    }
    return normalized.slice(0, this.maxInputChars);
  }

  private validateDimension(embeddings: EmbeddingBatch): void {
    for (const embedding of embeddings) {
      if (this.dim === 0) {
        this.dim = embedding.length;
      } else if (embedding.length !== this.dim) {
        throw new Error(
          `OpenAI embedding dimension mismatch. expected=${this.dim}, actual=${embedding.length}`,
        );
      }
    }
  }
}
