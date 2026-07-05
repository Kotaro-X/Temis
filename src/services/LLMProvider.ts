export type LLMGenerateOptions = {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
};

export interface LLMProvider {
  generate: (prompt: string, options?: LLMGenerateOptions) => Promise<string>;
}

class DummyLLMProvider implements LLMProvider {
  generate = async (): Promise<string> =>
    "ローカルLLMに接続できません。Ollamaの起動状態を確認してください。";
}

let provider: LLMProvider = new DummyLLMProvider();

export const getLLMProvider = (): LLMProvider => provider;

export const setLLMProvider = (nextProvider: LLMProvider): void => {
  provider = nextProvider;
};

export const generateWithLLM = (
  prompt: string,
  options?: LLMGenerateOptions,
): Promise<string> => provider.generate(prompt, options);
