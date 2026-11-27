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

/** Inert structured data; snapshots enforce finite numbers and resource bounds. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

export type NumericRange = Readonly<{
  min: number;
  max: number;
  minInclusive: boolean;
  maxInclusive: boolean;
}>;

/** The selected fact identifies the captured stream or typed run property. */
export const EXECUTION_FACT_KINDS = Object.freeze({
  stdout: "text",
  stderr: "text",
  exit_status: "number",
  boolean_property: "boolean",
  structured_stdout: "json",
  structured_stderr: "json",
} as const);

export type ExecutionFact = keyof typeof EXECUTION_FACT_KINDS;
export type ExecutionFactFor<K extends (typeof EXECUTION_FACT_KINDS)[ExecutionFact]> = {
  [F in ExecutionFact]: (typeof EXECUTION_FACT_KINDS)[F] extends K ? F : never;
}[ExecutionFact];

export type ExecutionTermination = "exited" | "timeout" | "crash";

/** Both inputs have already passed the same bounded inert-data snapshot. */
export function equalJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equalJsonValue(item, right[index]))
    );
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalJsonValue(a[key], b[key]))
  );
}

/** Unknown stream attribution is conservative; exit status is not a stream. */
export function captureTruncated(
  fact: unknown,
  stdoutTruncated: boolean,
  stderrTruncated: boolean,
): boolean {
  switch (fact) {
    case "exit_status":
      return false;
    case "stdout":
    case "structured_stdout":
      return stdoutTruncated;
    case "stderr":
    case "structured_stderr":
      return stderrTruncated;
    default:
      return stdoutTruncated || stderrTruncated;
  }
}
