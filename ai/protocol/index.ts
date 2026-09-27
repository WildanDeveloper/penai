/**
 * The text protocol the model speaks.
 *
 * A fenced `penai` block is how a model asks for a tool or records a finding.
 * A text protocol is used rather than native function calling so the same agent
 * works on every OpenAI-compatible gateway, many of which have partial or broken
 * tool-calling support. Because this is the trust boundary for the agent loop it
 * is strict: anything malformed is reported back rather than guessed at.
 */

export { parseModelOutput, formatToolResult } from './parse.js';
export type { ParsedResponse, ParsedFinding, ParsedToolCall } from './parse.js';
