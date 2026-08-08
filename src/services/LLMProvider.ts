export type LLMGenerateOptions = {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
};

export interface LLMProvider {
  generate: (prompt: string, options?: LLMGenerateOptions) => Promise<string>;
}

export class UnavailableLLMProvider implements LLMProvider {
  constructor(
    private readonly message =
      "このビルドではローカルLLMを利用できません。",
  ) {}

  generate = async (): Promise<string> => {
    throw new Error(this.message);
  };
}

let provider: LLMProvider = new UnavailableLLMProvider();

export const getLLMProvider = (): LLMProvider => provider;

export const setLLMProvider = (nextProvider: LLMProvider): void => {
  provider = nextProvider;
};

export const generateWithLLM = (
  prompt: string,
  options?: LLMGenerateOptions,
): Promise<string> => provider.generate(prompt, options);
