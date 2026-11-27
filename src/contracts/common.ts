/**
 * Versioned, portable data contracts for Assay.
 *
 * Types describe technical evidence, not authentication, academic authority
 * or execution isolation. Immutable references are caller claims until a host
 * independently verifies their provenance.
 */
export const ASSAY_SCHEMA_VERSION = 1 as const;

export const CONTRACT_LIMITS = Object.freeze({
  maxDepth: 12,
  maxNodes: 4096,
  maxInputBytes: 262_144,
  maxStringLength: 16_384,
  maxIdentifierLength: 96,
  maxObjectKeys: 32,
  maxArrayLength: 128,
  maxCriteria: 64,
  maxObservations: 128,
  maxSetItems: 128,
  maxEvidenceRefs: 32,
  maxDiagnostics: 32,
  maxCapturedBytes: 65_536,
} as const);

export type Completeness = "complete" | "truncated";

export type SetItemType = "string" | "number" | "boolean";
export type SetScalar = string | number | boolean;
