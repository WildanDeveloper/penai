/**
 * The AI layer.
 *
 * `agent` decides what to do, `transport` talks to the model, `protocol` parses
 * what the model says back, and `catalog`/`sources` describe where models come
 * from. The model proposes; `policy` disposes.
 */

export { Agent } from './agent/index.js';
export type { AgentEvents, ConfirmRequest } from './agent/index.js';
export { LlmClient, ProviderError } from './transport/index.js';
export { parseModelOutput, formatToolResult } from './protocol/index.js';
export { systemPrompt, playbookPrompt, PLAYBOOKS } from './agent/prompts.js';
export * from './catalog.js';
export * from './sources.js';
