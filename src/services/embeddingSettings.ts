import { getEmbeddingProvider, setEmbeddingProvider } from "./EmbeddingProvider";
import {
  OllamaEmbeddingProvider,
  OllamaEmbeddingProviderOptions,
} from "./OllamaEmbeddingProvider";

export type EmbeddingRuntimeConfig = {
  useOllama: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
  ollamaMaxInputChars: number;
  probeOnStartup: boolean;
};

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "nomic-embed-text";
const DEFAULT_OLLAMA_TIMEOUT_MS = 10_000;
const DEFAULT_OLLAMA_MAX_INPUT_CHARS = 2_000;

const parseBoolean = (
  value: string | undefined,
  fallback = false,
): boolean => {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return fallback;
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

export const getEmbeddingRuntimeConfig = (): EmbeddingRuntimeConfig => {
  const useOllamaFlag = parseBoolean(
    process.env.EXPO_PUBLIC_USE_OLLAMA_EMBEDDINGS,
    false,
  );
  const isDev = typeof __DEV__ === "boolean" ? __DEV__ : false;
  return {
    useOllama: isDev && useOllamaFlag,
    ollamaBaseUrl:
      process.env.EXPO_PUBLIC_OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL,
    ollamaModel: process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
    ollamaTimeoutMs: parseNumber(
      process.env.EXPO_PUBLIC_OLLAMA_TIMEOUT_MS,
      DEFAULT_OLLAMA_TIMEOUT_MS,
    ),
    ollamaMaxInputChars: parseNumber(
      process.env.EXPO_PUBLIC_OLLAMA_MAX_INPUT_CHARS,
      DEFAULT_OLLAMA_MAX_INPUT_CHARS,
    ),
    probeOnStartup: parseBoolean(
      process.env.EXPO_PUBLIC_OLLAMA_EMBEDDING_PROBE,
      false,
    ),
  };
};

export const createOllamaOptionsFromConfig = (
  config: EmbeddingRuntimeConfig,
): OllamaEmbeddingProviderOptions => ({
  baseUrl: config.ollamaBaseUrl,
  model: config.ollamaModel,
  timeoutMs: config.ollamaTimeoutMs,
  maxInputChars: config.ollamaMaxInputChars,
});

export const configureEmbeddingProviderFromEnv = (): EmbeddingRuntimeConfig => {
  const config = getEmbeddingRuntimeConfig();
  if (!config.useOllama) {
    return config;
  }
  setEmbeddingProvider(
    new OllamaEmbeddingProvider(createOllamaOptionsFromConfig(config)),
  );
  return config;
};

export const runEmbeddingProviderProbe = async (
  config: EmbeddingRuntimeConfig,
): Promise<void> => {
  if (!config.probeOnStartup) {
    return;
  }
  const provider = getEmbeddingProvider();
  const vector = await provider.embed("embedding provider health check");
  console.log(
    `[Embedding] probe ok provider=${config.useOllama ? "ollama" : "dummy"} dim=${vector.length}`,
  );
};
