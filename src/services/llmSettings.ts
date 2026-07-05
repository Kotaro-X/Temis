import { getLLMProvider, setLLMProvider } from "./LLMProvider";
import { OllamaLLMProvider, OllamaLLMProviderOptions } from "./OllamaLLMProvider";
import { resolveOllamaBaseUrl } from "./resolveOllamaBaseUrl";
import { LlamaRnLLMProvider } from "./LlamaRnLLMProvider";

export type LLMProviderKind = "local" | "ollama";

export type LLMRuntimeConfig = {
  provider: LLMProviderKind;
  useOllama: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
  ollamaMaxRetries: number;
  probeOnStartup: boolean;
};

export type OllamaConnectionCheckResult = {
  ok: boolean;
  reason?:
    | "unconfigured"
    | "timeout"
    | "network"
    | "http_error"
    | "model_not_found"
    | "unknown";
  detail?: string;
  status?: number;
  modelsCount?: number;
};

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.1:8b";
const DEFAULT_OLLAMA_TIMEOUT_MS = 30_000;
const DEFAULT_OLLAMA_MAX_RETRIES = 0;
const DEFAULT_PROVIDER: LLMProviderKind = "local";

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

const parseRetryCount = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(1, Math.floor(parsed));
};

const normalizeEnvString = (
  raw: string | undefined,
  fallback: string,
): string => {
  const trimmed = (raw ?? "").trim();
  const lowered = trimmed.toLowerCase();
  if (!trimmed || lowered === "undefined" || lowered === "null") {
    return fallback;
  }
  return trimmed;
};

const isInvalidEnvValue = (raw: string | undefined): boolean => {
  const trimmed = (raw ?? "").trim().toLowerCase();
  return trimmed === "" || trimmed === "undefined" || trimmed === "null";
};

const parseProviderKind = (
  value: string | undefined,
  fallback: LLMProviderKind,
): LLMProviderKind => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "ollama") {
    return "ollama";
  }
  if (normalized === "local") {
    return "local";
  }
  return fallback;
};

const formatErrorForLog = (error: unknown): string => {
  if (error instanceof Error) {
    const stack = error.stack ? `\n${error.stack}` : "";
    return `${error.name}: ${error.message}${stack}`;
  }
  return String(error);
};

export const getLLMRuntimeConfig = (): LLMRuntimeConfig => {
  const provider = parseProviderKind(
    process.env.EXPO_PUBLIC_LLM_PROVIDER,
    DEFAULT_PROVIDER,
  );
  const normalizedBaseUrl = normalizeEnvString(
    process.env.EXPO_PUBLIC_OLLAMA_LLM_BASE_URL,
    DEFAULT_OLLAMA_BASE_URL,
  );
  const resolvedBaseUrl = resolveOllamaBaseUrl(normalizedBaseUrl);
  const normalizedModel = normalizeEnvString(
    process.env.EXPO_PUBLIC_OLLAMA_LLM_MODEL,
    DEFAULT_OLLAMA_MODEL,
  );
  return {
    provider,
    useOllama: provider === "ollama",
    ollamaBaseUrl: resolvedBaseUrl,
    ollamaModel: normalizedModel,
    ollamaTimeoutMs: parseNumber(
      process.env.EXPO_PUBLIC_OLLAMA_LLM_TIMEOUT_MS,
      DEFAULT_OLLAMA_TIMEOUT_MS,
    ),
    ollamaMaxRetries: parseRetryCount(
      process.env.EXPO_PUBLIC_OLLAMA_LLM_MAX_RETRIES,
      DEFAULT_OLLAMA_MAX_RETRIES,
    ),
    probeOnStartup: parseBoolean(
      process.env.EXPO_PUBLIC_OLLAMA_LLM_PROBE,
      false,
    ),
  };
};

export const createOllamaLLMOptionsFromConfig = (
  config: LLMRuntimeConfig,
): OllamaLLMProviderOptions => ({
  baseUrl: config.ollamaBaseUrl,
  model: config.ollamaModel,
  timeoutMs: config.ollamaTimeoutMs,
  maxRetries: config.ollamaMaxRetries,
});

export const configureLLMProviderFromEnv = (): LLMRuntimeConfig => {
  const rawBaseUrl = process.env.EXPO_PUBLIC_OLLAMA_LLM_BASE_URL;
  const rawModel = process.env.EXPO_PUBLIC_OLLAMA_LLM_MODEL;
  const config = getLLMRuntimeConfig();
  if (config.provider === "ollama") {
    setLLMProvider(new OllamaLLMProvider(createOllamaLLMOptionsFromConfig(config)));
  } else {
    setLLMProvider(new LlamaRnLLMProvider());
  }
  if (typeof __DEV__ === "boolean" && __DEV__) {
    console.log(
      `[LLM] configure providerCreated=true provider=${config.provider} baseUrl=${config.ollamaBaseUrl} model=${config.ollamaModel}`,
    );
    console.log(
      `[LLM] env raw baseUrl=${JSON.stringify(rawBaseUrl)} model=${JSON.stringify(rawModel)}`,
    );
    if (config.provider === "ollama" && (isInvalidEnvValue(rawBaseUrl) || isInvalidEnvValue(rawModel))) {
      console.log("[LLM] env fallback applied to defaults for baseUrl/model");
    }
    if (
      config.provider === "ollama" &&
      !isInvalidEnvValue(rawModel) &&
      rawModel?.trim() !== DEFAULT_OLLAMA_MODEL
    ) {
      console.log(
        `[LLM] model override detected from env rawModel=${rawModel?.trim()} (default=${DEFAULT_OLLAMA_MODEL})`,
      );
    }
    if (config.provider === "ollama") {
      void checkOllamaConnection(config).catch((error) => {
        console.warn(
          `[LLM] check connection failed (unexpected): ${formatErrorForLog(error)}`,
        );
      });
    }
  }
  return config;
};

export const checkOllamaConnection = async (
  config: Pick<LLMRuntimeConfig, "ollamaBaseUrl" | "ollamaTimeoutMs" | "ollamaModel">,
): Promise<OllamaConnectionCheckResult> => {
  const isDev = typeof __DEV__ === "boolean" && __DEV__;
  const baseUrl = config.ollamaBaseUrl.trim();
  const model = config.ollamaModel.trim();
  if (!baseUrl || !model) {
    if (isDev) {
      console.warn("[LLM] check connection failed reason=unconfigured");
    }
    return {
      ok: false,
      reason: "unconfigured",
      detail: "baseUrl/model is empty after normalization",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      if (isDev) {
        console.warn(
          `[LLM] check connection failed reason=http_error status=${response.status} detail=${response.statusText}`,
        );
      }
      return {
        ok: false,
        reason: "http_error",
        detail: `${response.status} ${response.statusText}`,
        status: response.status,
      };
    }
    const payload = (await response.json()) as {
      models?: Array<{ name?: unknown; model?: unknown }>;
    };
    const models = Array.isArray(payload.models) ? payload.models : [];
    const modelNames = models
      .map((item) =>
        typeof item.name === "string"
          ? item.name
          : typeof item.model === "string"
            ? item.model
            : "",
      )
      .filter((name) => !!name);
    const hasModel = modelNames.some((name) => name === model);
    if (!hasModel) {
      const detail =
        modelNames.length > 0
          ? `configured model not found. configured=${model} available=${modelNames.join(", ")}`
          : `configured model not found. configured=${model} available=(none)`;
      if (isDev) {
        console.warn(`[LLM] check connection failed reason=model_not_found detail=${detail}`);
      }
      return {
        ok: false,
        reason: "model_not_found",
        detail,
        modelsCount: modelNames.length,
      };
    }
    if (isDev) {
      console.log(
        `[LLM] check connection ok via /api/tags models=${modelNames.length} model=${model}`,
      );
    }
    return { ok: true, modelsCount: modelNames.length };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutDetail = formatErrorForLog(error);
      if (isDev) {
        console.warn(
          `[LLM] check connection failed reason=timeout detail=${timeoutDetail}`,
        );
      }
      return {
        ok: false,
        reason: "timeout",
        detail: timeoutDetail,
      };
    }
    if (error instanceof TypeError) {
      if (isDev) {
        console.warn(
          `[LLM] check connection failed reason=network detail=${formatErrorForLog(error)}`,
        );
      }
      return {
        ok: false,
        reason: "network",
        detail: formatErrorForLog(error),
      };
    }
    if (isDev) {
      console.warn(
        `[LLM] check connection failed reason=unknown detail=${formatErrorForLog(error)}`,
      );
    }
    return {
      ok: false,
      reason: "unknown",
      detail: formatErrorForLog(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const runLLMProviderProbe = async (
  config: LLMRuntimeConfig,
): Promise<void> => {
  if (!config.probeOnStartup) {
    return;
  }
  if (config.provider === "ollama") {
    const connection = await checkOllamaConnection(config);
    if (!connection.ok) {
      throw new Error(
        `Ollama connection failed (${connection.reason ?? "unknown"}): ${connection.detail ?? "-"}`,
      );
    }
  }
  const response = await runLLMHelloProbe();
  const sample = response.replace(/\s+/g, " ").slice(0, 80);
  console.log(
    `[LLM] probe ok provider=${config.provider} sample="${sample}"`,
  );
};

export const runLLMHelloProbe = async (): Promise<string> => {
  const provider = getLLMProvider();
  return provider.generate("Hello", {
    temperature: 0,
    maxTokens: 64,
  });
};
