import { initLlama } from "llama.rn";
import type { LlamaContext } from "llama.rn";
import { LLMGenerateOptions, LLMProvider } from "./LLMProvider";
import { resolveBundledModel } from "./localLlamaModel";

export type LlamaRnLLMProviderOptions = {
  contextTokens?: number;
  threads?: number;
  gpuLayers?: number;
  useMlock?: boolean;
};

const DEFAULT_CONTEXT_TOKENS = 1024;
const DEFAULT_THREADS = 6;
const DEFAULT_GPU_LAYERS = 35;
const DEFAULT_USE_MLOCK = false;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_MAX_TOKENS = 192;
const STOP_WORDS = ["```", "\n\n\n"];

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

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
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

export class LlamaRnLLMProvider implements LLMProvider {
  private readonly contextTokens: number;
  private readonly threads: number;
  private readonly gpuLayers: number;
  private readonly useMlock: boolean;
  private contextPromise?: Promise<LlamaContext>;
  private generationQueue: Promise<void> = Promise.resolve();

  constructor(options: LlamaRnLLMProviderOptions = {}) {
    this.contextTokens =
      options.contextTokens ??
      parseNumber(process.env.EXPO_PUBLIC_LOCAL_LLM_CTX, DEFAULT_CONTEXT_TOKENS);
    this.threads =
      options.threads ??
      parseNumber(process.env.EXPO_PUBLIC_LOCAL_LLM_THREADS, DEFAULT_THREADS);
    this.gpuLayers =
      options.gpuLayers ??
      parseNumber(
        process.env.EXPO_PUBLIC_LOCAL_LLM_GPU_LAYERS,
        DEFAULT_GPU_LAYERS,
      );
    this.useMlock =
      options.useMlock ??
      parseBoolean(process.env.EXPO_PUBLIC_LOCAL_LLM_MLOCK, DEFAULT_USE_MLOCK);
  }

  private async getContext(): Promise<LlamaContext> {
    if (!this.contextPromise) {
      this.contextPromise = this.createContext();
    }
    return this.contextPromise;
  }

  private async createContext(): Promise<LlamaContext> {
    const model = await resolveBundledModel();
    return (await initLlama({
      model: model.uri,
      n_ctx: this.contextTokens,
      n_threads: this.threads,
      n_gpu_layers: this.gpuLayers,
      use_mlock: this.useMlock,
    })) as LlamaContext;
  }

  generate = async (
    prompt: string,
    options?: LLMGenerateOptions,
  ): Promise<string> => {
    return this.enqueueGeneration(async () => {
      const context = await this.getContext();
      const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
      const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;
      const response = await context.completion({
        prompt,
        n_predict: Math.max(1, Math.floor(maxTokens)),
        temperature,
        stop: STOP_WORDS,
      });
      if (!response || typeof response.text !== "string") {
        throw new Error("ローカルLLMの応答形式が不正です。");
      }
      return response.text.trim();
    });
  };

  private enqueueGeneration<T>(task: () => Promise<T>): Promise<T> {
    const runTask = this.generationQueue.then(task, task);
    this.generationQueue = runTask.then(
      () => undefined,
      () => undefined,
    );
    return runTask;
  }
}
