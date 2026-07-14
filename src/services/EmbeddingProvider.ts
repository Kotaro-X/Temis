export type EmbeddingVector = number[];
export type EmbeddingBatch = number[][];

export interface EmbeddingProvider {
  embed: (text: string) => Promise<EmbeddingVector>;
  embedBatch: (texts: string[]) => Promise<EmbeddingBatch>;
  getDim: () => number;
  getModel: () => string;
  getModelVersion: () => string;
}

const DUMMY_VECTOR_DIMENSION = 32;

const buildDummyEmbedding = (text: string): EmbeddingVector => {
  const vector = new Array<number>(DUMMY_VECTOR_DIMENSION).fill(0);
  if (!text) {
    return vector;
  }
  const normalized = text.trim();
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    const bucket = index % DUMMY_VECTOR_DIMENSION;
    vector[bucket] += code / 65535;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => Number((value / norm).toFixed(6)));
};

class DummyEmbeddingProvider implements EmbeddingProvider {
  embed = async (text: string): Promise<EmbeddingVector> =>
    buildDummyEmbedding(text);

  embedBatch = async (texts: string[]): Promise<EmbeddingBatch> =>
    texts.map((text) => buildDummyEmbedding(text));

  getDim = (): number => DUMMY_VECTOR_DIMENSION;

  getModel = (): string => "dummy-embedding-v1";

  getModelVersion = (): string => this.getModel();
}

let provider: EmbeddingProvider = new DummyEmbeddingProvider();

export const getEmbeddingProvider = (): EmbeddingProvider => provider;

export const setEmbeddingProvider = (nextProvider: EmbeddingProvider): void => {
  provider = nextProvider;
};

export const embedText = (text: string): Promise<EmbeddingVector> =>
  provider.embed(text);

export const embedBatchText = (texts: string[]): Promise<EmbeddingBatch> =>
  provider.embedBatch(texts);

export const getEmbeddingDimension = (): number => provider.getDim();

export const getEmbeddingModelVersion = (): string =>
  provider.getModelVersion();
