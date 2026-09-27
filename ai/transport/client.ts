/**
 * Provider-agnostic LLM client.
 *
 * Speaks to any OpenAI-compatible /chat/completions endpoint (OpenAI,
 * OpenRouter, Together, vLLM, Ollama, LM Studio, corporate gateways) and to the
 * Anthropic Messages API. No key is read from another tool's config; the caller
 * configures a provider explicitly.
 */

import type { Message, ProviderConfig } from '../../model/index.js';
import { sseStream } from './sse.js';
import { ProviderError } from './errors.js';
import { describeHttpError } from './http-error.js';
import { ZEN } from '../catalog.js';

export { ProviderError };

export interface CompletionRequest {
  messages: Message[];
  system: string;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}

interface SseEvent {
  data: string;
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith(path) ? trimmed : `${trimmed}${path}`;
}

export class LlmClient {
  constructor(private readonly config: ProviderConfig) {}

  get model(): string {
    return this.config.model;
  }

  /** A local endpoint (Ollama, LM Studio) needs no key; a hosted one does. */
  get ready(): boolean {
    return this.config.apiKey.length > 0 || /localhost|127\.0\.0\.1/.test(this.config.baseUrl);
  }

  /**
   * True when this endpoint is called with no credential of the operator's: the
   * anonymous free tier, or something running on this machine. The client says so
   * rather than reporting a key it never received.
   */
  get anonymous(): boolean {
    return this.config.apiKey === ZEN.publicKey || /localhost|127\.0\.0\.1/.test(this.config.baseUrl);
  }

  private async post(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) headers['authorization'] = `Bearer ${this.config.apiKey}`;
    if (this.config.kind === 'anthropic') {
      headers['x-api-key'] = this.config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      delete headers['authorization'];
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(300_000),
      });
    } catch (error) {
      throw new ProviderError(`cannot reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(describeHttpError(res.status, text, this.config.baseUrl), res.status, text.slice(0, 2000));
    }
    return res;
  }

  /** Stream a completion, invoking `onToken` for each delta. Returns the full text. */
  async complete(request: CompletionRequest): Promise<string> {
    if (this.config.kind === 'anthropic') return this.completeAnthropic(request);
    return this.completeOpenAI(request);
  }

  private async completeOpenAI(request: CompletionRequest): Promise<string> {
    const url = joinUrl(this.config.baseUrl, '/chat/completions');
    const res = await this.post(
      url,
      {
        model: this.config.model,
        stream: true,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages: [{ role: 'system', content: request.system }, ...request.messages.map((m) => ({ role: m.role, content: m.content }))],
      },
      request.signal,
    );

    // Some gateways ignore stream:true and return a single JSON object.
    if (!res.body) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content ?? '';
      request.onToken?.(text);
      return text;
    }

    let full = '';
    for await (const event of sseStream(res, request.signal)) {
      if (event.data === '[DONE]') break;
      let json: {
        choices?: { delta?: { content?: string } }[];
        error?: { message?: string };
      };
      try {
        json = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (json.error?.message) throw new ProviderError(json.error.message);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        request.onToken?.(delta);
      }
    }
    return full;
  }

  private async completeAnthropic(request: CompletionRequest): Promise<string> {
    const url = joinUrl(this.config.baseUrl, '/messages');
    // Anthropic takes the system prompt out of band and only accepts
    // user/assistant turns in the message list.
    const messages = request.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await this.post(
      url,
      {
        model: this.config.model,
        system: request.system,
        stream: true,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages,
      },
      request.signal,
    );

    let full = '';
    for await (const event of sseStream(res, request.signal)) {
      if (event.data === '[DONE]') break;
      let json: { type?: string; delta?: { text?: string }; error?: { message?: string } };
      try {
        json = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (json.type === 'error' && json.error?.message) throw new ProviderError(json.error.message);
      if (json.type === 'content_block_delta' && json.delta?.text) {
        full += json.delta.text;
        request.onToken?.(json.delta.text);
      }
    }
    return full;
  }

  /** Non-streaming convenience wrapper. */
  async completeOnce(messages: Message[], system: string, signal?: AbortSignal): Promise<string> {
    return this.complete({ messages, system, signal });
  }
}

export type { SseEvent };
