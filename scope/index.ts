/**
 * Scope engine.
 *
 * Every network operation in PENAI must resolve to something the operator
 * authorised. This is the single source of truth for that decision and it is
 * consulted by the policy layer, not just the prompt.
 */

export * from './classify.js';
export * from './match.js';
export * from './extract.js';
