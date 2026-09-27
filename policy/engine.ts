/**
 * The policy engine — the gate between "the model wants to do something" and
 * "something happens on the wire".
 *
 * Layers, in order:
 *   1. hard denylist      (DoS, destructive, self-modifying, code-download-and-run)
 *   2. risk vs. mode      (the ceiling on unattended execution)
 *   3. argument schema    (required args present, types sane)
 *   4. scope              (every referenced host must be authorised)
 *
 * Nothing reaches the network without a `run` decision from here.
 */

import type { Mode, PolicyConfig, Risk, Tool } from '../model/index.js';
import { MODE_MAX_RISK } from '../model/index.js';
import { classifyTarget, extractTargets } from '../scope/index.js';
import type { Scope } from '../scope/index.js';
import type { Action, Decision } from './types.js';
import { riskAtLeast } from './risk.js';
import { HARD_DENY, MANUAL_ONLY } from './denylist.js';
import { ALLOWED_BINARIES, TARGET_ARG, hasShellMetachars, looksLikeTarget, splitArgs } from './shell.js';

/** A bare routable literal: IP, CIDR or hostname — but not a full URL or payload. */
function looksLikeLiteralTarget(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (value.includes('/') && !/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(value)) return false;
  if (value.includes('@')) return false;
  return looksLikeTarget(value);
}

export class PolicyEngine {
  constructor(
    private readonly scopeRules: Scope,
    private policy: PolicyConfig,
  ) {}

  get config(): PolicyConfig {
    return this.policy;
  }

  /** The scope this engine enforces, so callers can build an agent against it. */
  get scope(): Scope {
    return this.scopeRules;
  }

  setMode(mode: Mode): void {
    this.policy = { ...this.policy, mode };
  }

  get mode(): Mode {
    return this.policy.mode;
  }

  private ceiling(): Risk {
    return MODE_MAX_RISK[this.policy.mode];
  }

  private static riskOf(risk: Risk, command: string): { risk: Risk; why: string; manual: boolean } {
    for (const rule of MANUAL_ONLY) {
      if (rule.re.test(command)) return { risk: rule.risk, why: rule.why, manual: true };
    }
    return { risk, why: '', manual: false };
  }

  private static hardDeny(command: string): string | undefined {
    for (const rule of HARD_DENY) {
      if (rule.re.test(command)) return rule.why;
    }
    return undefined;
  }

  private static collectArgTargets(tool: Tool, args: Record<string, unknown>): string[] {
    const targets: string[] = [];
    const byName = new Map(tool.args.map((a) => [a.name.toLowerCase(), a]));
    for (const [key, value] of Object.entries(args)) {
      const spec = byName.get(key.toLowerCase());
      // Explicitly-declared payload/header arguments are never targets.
      if (spec?.notTarget) continue;
      const named = spec ? TARGET_ARG.test(spec.name) : TARGET_ARG.test(key);
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (typeof item !== 'string' || item === '') continue;
        if (named) targets.push(item);
        else if (looksLikeLiteralTarget(item)) targets.push(item);
      }
    }
    return targets;
  }

  private static missingArgs(tool: Tool, args: Record<string, unknown>): string[] {
    const missing: string[] = [];
    for (const spec of tool.args) {
      if (!spec.required) continue;
      const value = args[spec.name];
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        missing.push(spec.name);
      }
    }
    return missing;
  }

  private async scopeCheck(targets: string[]): Promise<{ ok: boolean; reason: string }> {
    if (this.scope.empty) {
      return { ok: false, reason: 'scope is empty — add authorised targets first (`/scope add <target>`)' };
    }
    if (targets.length === 0) return { ok: true, reason: 'no routable target in arguments' };
    return this.scopeRules.checkAll(targets);
  }

  async evaluateTool(
    tool: Tool,
    args: Record<string, unknown>,
    actor: 'user' | 'model',
  ): Promise<Decision> {
    const command = `${tool.name} ${JSON.stringify(args)}`;
    const targets = PolicyEngine.collectArgTargets(tool, args);
    const base: Decision = { action: 'run', risk: tool.risk, reason: '', targets, command, tool: tool.name };

    const missing = PolicyEngine.missingArgs(tool, args);
    if (missing.length > 0) {
      return { ...base, action: 'deny', reason: `missing required argument(s): ${missing.join(', ')}` };
    }

    const denied = PolicyEngine.hardDeny(command);
    if (denied) return { ...base, action: 'deny', reason: `hard-denied: ${denied}` };

    const { risk, why, manual } = PolicyEngine.riskOf(tool.risk, command);
    if (manual) {
      return { ...base, risk, action: 'manual', reason: `manual-only: ${why}` };
    }

    const scopeResult = await this.scopeCheck(targets);
    if (!scopeResult.ok) return { ...base, risk, action: 'deny', reason: `out of scope: ${scopeResult.reason}` };

    if (riskAtLeast(risk, this.ceiling())) {
      return { ...base, risk, action: 'run', reason: actor === 'user' ? `operator-issued (${risk})` : `within ${this.policy.mode} ceiling (${risk})` };
    }
    if (actor === 'user') {
      // The operator picked this tool and these arguments deliberately. The mode
      // ceiling exists to bound *autonomous* execution, not to second-guess the
      // human at the keyboard; the decision is still written to the audit log.
      return { ...base, risk, action: 'run', reason: `operator-issued (${risk} exceeds ${this.policy.mode} ceiling; auto-run for the agent is still capped)` };
    }
    return {
      ...base,
      risk,
      action: 'confirm',
      reason: `${risk} risk exceeds ${this.policy.mode} mode ceiling (${this.ceiling()}); approval required`,
    };
  }

  async evaluateShell(command: string, actor: 'user' | 'model'): Promise<Decision> {
    const trimmed = command.trim();
    const tokens = splitArgs(trimmed);
    const binary = tokens[0]?.split('/').pop() ?? '';
    const targets = extractTargets(trimmed);
    const base: Decision = { action: 'run', risk: 'medium', reason: '', targets, command: trimmed, tool: binary };

    // 1. Unconditional refusals, whatever the mode or the operator says.
    const denied = PolicyEngine.hardDeny(trimmed);
    if (denied) return { ...base, action: 'deny', reason: `hard-denied: ${denied}` };

    // 2. Intrusive but legitimate actions: never auto-executed, not gated by the
    //    shell switch either — the operator is simply shown the exact command.
    const { risk, why, manual } = PolicyEngine.riskOf('medium', trimmed);
    if (manual) return { ...base, risk, action: 'manual', reason: `manual-only: ${why}` };

    if (!this.policy.allowShell) {
      return { ...base, action: 'deny', reason: 'shell execution disabled (set PENAI_ALLOW_SHELL=1 to enable)' };
    }
    if (hasShellMetachars(trimmed)) {
      if (actor === 'model') {
        return { ...base, action: 'deny', reason: 'shell metacharacters (| ; & $ ` > <) are not allowed for model-issued commands' };
      }
      return { ...base, action: 'confirm', reason: 'operator command contains shell metacharacters — verify carefully' };
    }
    if (!ALLOWED_BINARIES.has(binary)) {
      return { ...base, action: 'deny', reason: `binary "${binary}" is not on the allowlist` };
    }
    if (targets.length === 0) {
      return { ...base, action: 'deny', reason: 'command references no identifiable target' };
    }

    const scopeResult = await this.scopeCheck(targets);
    if (!scopeResult.ok) return { ...base, risk, action: 'deny', reason: `out of scope: ${scopeResult.reason}` };

    if (actor === 'user' || riskAtLeast(risk, this.ceiling())) {
      return {
        ...base,
        risk,
        action: 'run',
        reason: actor === 'user' ? `operator-issued (${risk})` : `within ${this.policy.mode} ceiling`,
      };
    }
    return { ...base, risk, action: 'confirm', reason: `${risk} risk exceeds ${this.policy.mode} mode ceiling (${this.ceiling()})` };
  }
}
