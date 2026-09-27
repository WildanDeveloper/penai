/**
 * Running a registered external tool and reducing its output.
 *
 * The tool output is never handed to the model verbatim: it is summarised here
 * so a multi-megabyte scan does not become a context bill.
 */

import type { ExternalTool, ToolResult } from "../../model/index.js";
import { asInt, clamp, truncate } from "../../internal/util.js";
import { which } from "./discover.js";
import { execCapture, lines } from "./exec.js";

export async function runExternal(
  tool: ExternalTool,
  args: Record<string, unknown>,
  ctx: { emit: (t: string) => void; signal: AbortSignal; evidenceLimit: number },
): Promise<{ result: ToolResult; command: string }> {
  const bin = which(tool.bin);
  if (!bin) {
    return {
      command: tool.bin,
      result: { ok: false, summary: `${tool.bin} is not installed`, data: {}, error: 'tool not found on PATH' },
    };
  }
  const argv = tool.build(args);
  const timeoutSec = clamp(asInt(args.timeoutSec, 300), 5, 3600);
  const command = `${tool.bin} ${argv.filter((a) => !a.includes('\n')).join(' ')}`;
  ctx.emit(`$ ${command}`);
  const exec = await execCapture(bin, argv, timeoutSec * 1000, ctx.signal);
  const { text, truncated } = truncate(`${exec.stdout}\n${exec.stderr ? `[stderr]\n${exec.stderr}` : ''}`.trim(), ctx.evidenceLimit);
  const parsed = tool.summarize(exec.stdout);
  const ok = exec.code === 0 && exec.stdout.trim().length > 0;

  if (!ok) {
    const lastError = lines(exec.stderr).slice(-3).join(' | ') || `exit ${exec.code}`;
    return {
      command,
      result: {
        ok: false,
        summary: `${tool.name} produced no usable output (${lastError})`,
        data: { exitCode: exec.code, timedOut: exec.timedOut },
        error: lastError,
        evidence: text,
      },
    };
  }
  return {
    command,
    result: {
      ok: true,
      summary: parsed.summary,
      data: parsed.data,
      evidence: text,
      ...(truncated ? {} : {}),
    },
  };
}
