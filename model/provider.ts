/** Where and how to reach the model. */

export interface ProviderConfig {
  /** 'openai' = OpenAI-compatible /chat/completions, 'anthropic' = Messages API. */
  kind: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}
