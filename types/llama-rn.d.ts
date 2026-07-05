declare module "llama.rn" {
  export type LlamaContext = {
    completion: (options: {
      prompt: string;
      n_predict?: number;
      temperature?: number;
      stop?: string[];
    }) => Promise<{ text?: string }>;
  };

  export function initLlama(options: {
    model: string;
    n_ctx?: number;
    n_threads?: number;
    n_gpu_layers?: number;
    use_mlock?: boolean;
  }): Promise<LlamaContext>;
}
