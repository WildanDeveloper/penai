/**
 * SARIF 2.1.0 output, for importing findings into code-scanning tooling.
 */

import { SEVERITY_ORDER } from '../model/index.js';
import type { Severity } from '../model/index.js';
import type { ReportInput } from './shared.js';

const SARIF_LEVEL: Record<Severity, string> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
};

export function toSarif(input: ReportInput): string {
  const rules: unknown[] = [];
  const results: unknown[] = [];
  const ruleIndex = new Map<string, number>();

  for (const finding of input.findings) {
    if (finding.status === 'false_positive') continue;
    const key = finding.cwe ?? 'penai.generic';
    if (!ruleIndex.has(key)) {
      ruleIndex.set(key, rules.length);
      rules.push({
        id: key,
        name: key,
        shortDescription: { text: finding.title },
        fullDescription: { text: finding.description },
        helpUri: key.startsWith('CWE-') ? `https://cwe.mitre.org/data/definitions/${key.slice(4)}.html` : undefined,
      });
    }
    results.push({
      ruleId: key,
      ruleIndex: ruleIndex.get(key),
      level: SARIF_LEVEL[finding.severity],
      message: { text: `${finding.title} — ${finding.description.slice(0, 400)}` },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: finding.asset },
            region: { startLine: 1 },
          },
          logicalLocations: [{ name: finding.asset }],
        },
      ],
      properties: {
        severity: finding.severity,
        asset: finding.asset,
        evidence: finding.evidence.slice(0, 2000),
        remediation: finding.remediation,
        owasp: finding.owasp,
        status: finding.status,
      },
    });
  }

  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'PENAI',
              informationUri: 'https://github.com/penai/penai',
              rules,
            },
          },
          invocations: [
            {
              executionSuccessful: true,
              endTimeUtc: input.generatedAt ?? new Date().toISOString(),
              properties: { engagement: input.engagement, tester: input.tester },
            },
          ],
          results,
        },
      ],
    },
    null,
    2,
  );
}
