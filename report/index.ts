/**
 * Report generation.
 *
 * Markdown, HTML, SARIF and JSON are all rendered from the same stored evidence,
 * so the four formats can never disagree about what was found.
 */

import type { ReportInput } from './shared.js';
import { toHtml } from './html.js';
import { toMarkdown } from './markdown.js';
import { toSarif } from './sarif.js';

export type ReportFormat = 'markdown' | 'html' | 'sarif' | 'json';

export function render(format: ReportFormat, input: ReportInput): string {
  switch (format) {
    case 'markdown':
      return toMarkdown(input);
    case 'html':
      return toHtml(input);
    case 'sarif':
      return toSarif(input);
    case 'json':
      return JSON.stringify(input, null, 2);
  }
}

export * from './shared.js';
