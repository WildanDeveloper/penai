/**
 * Parses the model's reply into prose, tool calls, findings and shell commands.
 *
 * A text protocol is used instead of native function calling so that the same
 * agent works on every OpenAI-compatible gateway (many of which have partial or
 * broken tool-calling support). Because parsing is the trust boundary for the
 * agent loop, it is deliberately strict: anything that is not well-formed is
 * reported back to the model as an error rather than guessed at.
 */

import type { Severity } from '../../model/index.js';

export interface ParsedToolCall {
  tool: string;
  args: Record<string, unknown>;
  raw: string;
}

export interface ParsedFinding {
  title: string;
  severity: Severity;
  asset: string;
  description: string;
  evidence: string;
  reproduction: string;
  remediation: string;
  cwe?: string;
  owasp?: string;
  cvss?: string;
}

export interface ParsedResponse {
  prose: string;
  toolCalls: ParsedToolCall[];
  findings: ParsedFinding[];
  shells: string[];
  errors: string[];
}

const BLOCK_RE = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

function coerceSeverity(value: unknown): Severity {
  const text = String(value ?? '').toLowerCase().trim();
  if ((SEVERITIES as string[]).includes(text)) return text as Severity;
  // Common synonyms the model reaches for.
  if (/^(severe|crit|urgent|p0)$/.test(text)) return 'critical';
  if (/^(important|severe-ish|significant)$/.test(text)) return 'high';
  if (/^(moderate|med|normal)$/.test(text)) return 'medium';
  if (/^(minor|informational|none|note)$/.test(text)) return 'low';
  return 'medium';
}

function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toFinding(raw: unknown): ParsedFinding | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const f = raw as Record<string, unknown>;
  const title = str(f.title ?? f.name).trim();
  if (!title) return undefined;
  return {
    title,
    severity: coerceSeverity(f.severity ?? f.level),
    asset: str(f.asset ?? f.target ?? f.url ?? f.host, 'unspecified'),
    description: str(f.description ?? f.detail ?? f.impact),
    evidence: str(f.evidence ?? f.proof ?? f.output),
    reproduction: str(f.reproduction ?? f.steps ?? f.repro),
    remediation: str(f.remediation ?? f.fix ?? f.recommendation),
    ...(str(f.cwe) ? { cwe: str(f.cwe) } : {}),
    ...(str(f.owasp) ? { owasp: str(f.owasp) } : {}),
    ...(str(f.cvss) ? { cvss: str(f.cvss) } : {}),
  };
}

function toToolCall(raw: unknown): ParsedToolCall | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const name = str(o.tool ?? o.name).trim();
  if (!name) return undefined;
  const args = o.args ?? o.arguments ?? o.input ?? o.parameters;
  return {
    tool: name,
    args: args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
    raw: JSON.stringify(raw),
  };
}

export function parseModelOutput(text: string): ParsedResponse {
  const out: ParsedResponse = { prose: '', toolCalls: [], findings: [], shells: [], errors: [] };
  let cursor = 0;
  const proseParts: string[] = [];

  for (const match of text.matchAll(BLOCK_RE)) {
    const index = match.index ?? 0;
    proseParts.push(text.slice(cursor, index));
    cursor = index + match[0].length;

    const language = (match[1] ?? '').toLowerCase();
    const body = (match[2] ?? '').trim();

    if (language === 'bash' || language === 'sh' || language === 'shell' || language === 'console') {
      if (body) out.shells.push(body);
      continue;
    }
    if (!body) {
      out.errors.push('empty fenced block ignored');
      continue;
    }
    if (!['penai', 'tool', 'json', ''].includes(language)) continue; // ordinary prose code sample

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      out.errors.push(
        `could not parse the tool/finding block as JSON (${error instanceof Error ? error.message : String(error)}). ` +
          'Emit exactly one JSON object per block with keys "tool"/"args" or "finding".',
      );
      continue;
    }

    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (obj.finding !== undefined) {
          const finding = toFinding(obj.finding);
          if (finding) out.findings.push(finding);
          else out.errors.push('finding block is missing a title');
          continue;
        }
        if (obj.findings !== undefined) {
          const list = Array.isArray(obj.findings) ? obj.findings : [obj.findings];
          for (const entry of list) {
            const finding = toFinding(entry);
            if (finding) out.findings.push(finding);
          }
          continue;
        }
        const call = toToolCall(obj);
        if (call) out.toolCalls.push(call);
        else out.errors.push(`block did not contain a "tool" or "finding" key: ${body.slice(0, 120)}`);
        continue;
      }
      out.errors.push(`block was not a JSON object: ${body.slice(0, 120)}`);
    }
  }
  proseParts.push(text.slice(cursor));

  out.prose = proseParts
    .join('')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out;
}

/** Render a tool result back to the model compactly. */
export function formatToolResult(
  tool: string,
  ok: boolean,
  summary: string,
  evidence: string | undefined,
  limit = 6000,
): string {
  const body = (evidence ?? '').slice(0, limit);
  const suffix = (evidence ?? '').length > limit ? `\n...[${(evidence ?? '').length - limit} more chars stored as evidence]` : '';
  return `<tool_result tool="${tool}" ok="${ok}">\n${summary}\n${body}${suffix}\n</tool_result>`;
}
