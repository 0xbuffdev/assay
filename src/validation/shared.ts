import { CONTRACT_LIMITS, type SetItemType } from "../contracts/common";
import type {
  DiagnosticCode,
  ValidationDiagnostic,
  ValidationDomain,
  ValidationResult,
} from "../contracts/validation";

export type DataObject = Record<string, unknown>;
export const BAD = Symbol("invalid");
const encoder = new TextEncoder();

// Only published schema field names may appear in snapshot diagnostic paths.
// Unknown input keys remain redacted even when their nested values are invalid.
const DIAGNOSTIC_PATH_FIELDS = new Set([
  "schemaVersion",
  "assessmentId",
  "revision",
  "revisionDigest",
  "policyVersion",
  "criteria",
  "id",
  "mode",
  "kind",
  "visibility",
  "parameters",
  "expected",
  "type",
  "value",
  "referenceId",
  "normalization",
  "lineEndings",
  "unicode",
  "case",
  "whitespace",
  "trim",
  "tolerance",
  "absolute",
  "relative",
  "unit",
  "itemType",
  "order",
  "duplicates",
  "assertions",
  "review",
  "definition",
  "artifactDigest",
  "observations",
  "criterionId",
  "evidenceRef",
  "completeness",
  "items",
  "runRef",
  "assertionId",
  "state",
  "artifactRefs",
  "outcome",
  "reasonCode",
  "evidenceRefs",
  "evaluatorId",
  "evaluatorVersion",
  "evaluator",
  "version",
  "findings",
  "warnings",
  "provenance",
  "adapterId",
  "adapterVersion",
  "toolchainId",
  "toolchainVersion",
  "capturedStdoutBytes",
  "capturedStderrBytes",
  "stdoutTruncated",
  "stderrTruncated",
]);

export class Diagnostics {
  readonly entries: ValidationDiagnostic[] = [];

  add(path: string, code: DiagnosticCode): void {
    if (this.entries.length < CONTRACT_LIMITS.maxDiagnostics - 1) {
      this.entries.push(Object.freeze({ path, code }));
    } else if (this.entries.length === CONTRACT_LIMITS.maxDiagnostics - 1) {
      this.entries.push(Object.freeze({ path: "$", code: "TOO_MANY_DIAGNOSTICS" }));
    }
  }

  result<T>(domain: ValidationDomain, value: T): ValidationResult<T> {
    if (this.entries.length > 0) {
      return Object.freeze({ ok: false, domain, diagnostics: Object.freeze([...this.entries]) });
    }
    return Object.freeze({ ok: true, value });
  }
}

/**
 * Copy and bound unknown JavaScript data before validating it.
 * This prevents accessor invocation, cycles, inherited fields, mutable values,
 * and prototype-pollution keys from entering the typed contract.
 *
 * This is not a JSON parser: callers must reject duplicate keys before
 * JSON.parse discards them when exact serialized identity matters.
 */
export function snapshot(input: unknown, issues: Diagnostics): unknown | typeof BAD {
  const active = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;

  function visit(value: unknown, path: string, depth: number): unknown | typeof BAD {
    nodes++;
    if (nodes > CONTRACT_LIMITS.maxNodes) {
      issues.add(path, "INPUT_TOO_LARGE");
      return BAD;
    }
    if (depth > CONTRACT_LIMITS.maxDepth) {
      issues.add(path, "INPUT_TOO_DEEP");
      return BAD;
    }

    if (typeof value === "string") {
      if (value.length > CONTRACT_LIMITS.maxStringLength) {
        issues.add(path, "INPUT_TOO_LARGE");
        return BAD;
      }
      bytes += encoder.encode(value).byteLength;
      if (bytes > CONTRACT_LIMITS.maxInputBytes) {
        issues.add(path, "INPUT_TOO_LARGE");
        return BAD;
      }
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        issues.add(path, "UNSAFE_NUMBER");
        return BAD;
      }
      return value;
    }
    if (value === null || typeof value === "boolean") return value;

    if (typeof value !== "object") {
      issues.add(path, "UNSUPPORTED_INPUT");
      return BAD;
    }

    if (active.has(value)) {
      issues.add(path, "UNSAFE_OBJECT");
      return BAD;
    }

    try {
      const isArray = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if (
        isArray
          ? prototype !== Array.prototype
          : prototype !== Object.prototype && prototype !== null
      ) {
        issues.add(path, "UNSAFE_OBJECT");
        return BAD;
      }

      // Reject dense oversized arrays before enumerating their indexed keys.
      // Do not materialize descriptors for every property of unknown input.
      if (isArray) {
        if (!Number.isSafeInteger(value.length) || value.length > CONTRACT_LIMITS.maxArrayLength) {
          issues.add(path, "TOO_MANY_ITEMS");
          return BAD;
        }
      } else {
        // for...in can stop after the first over-limit enumerable key instead
        // of allocating an entire property-descriptor map for a large object.
        let enumerableCount = 0;
        for (const key in value) {
          if (!Object.hasOwn(value, key)) {
            issues.add(path, "UNSAFE_OBJECT");
            return BAD;
          }
          if (++enumerableCount > CONTRACT_LIMITS.maxObjectKeys) {
            issues.add(path, "TOO_MANY_ITEMS");
            return BAD;
          }
          if (key.length > CONTRACT_LIMITS.maxStringLength) {
            issues.add(path, "INPUT_TOO_LARGE");
            return BAD;
          }
        }
      }

      // Enumerate own names only after the cheap preflight, so hidden keys,
      // symbols, sparse indices and accessors are still rejected.
      const keys = Reflect.ownKeys(value);
      if (keys.length > (isArray ? value.length + 1 : CONTRACT_LIMITS.maxObjectKeys)) {
        issues.add(path, "TOO_MANY_ITEMS");
        return BAD;
      }
      if (keys.some((key) => typeof key !== "string")) {
        issues.add(path, "UNSAFE_KEY");
        return BAD;
      }

      active.add(value);
      if (isArray) {
        const length = value.length;
        if (
          keys.length !== length + 1 ||
          keys.some(
            (key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)),
          )
        ) {
          issues.add(path, "UNSAFE_OBJECT");
          return BAD;
        }
        const output: unknown[] = [];
        for (let i = 0; i < length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !Object.hasOwn(descriptor, "value")) {
            issues.add(path, "UNSAFE_OBJECT");
            return BAD;
          }
          const item = visit(descriptor.value, `${path}[${i}]`, depth + 1);
          if (item === BAD) return BAD;
          output.push(item);
        }
        return Object.freeze(output);
      }

      const names = (keys as string[]).sort();

      const output: DataObject = Object.create(null) as DataObject;
      for (const key of names) {
        // Never reflect an attacker-controlled key into public diagnostics.
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          issues.add(path, "UNSAFE_KEY");
          return BAD;
        }
        bytes += encoder.encode(key).byteLength;
        if (bytes > CONTRACT_LIMITS.maxInputBytes) {
          issues.add(path, "INPUT_TOO_LARGE");
          return BAD;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          issues.add(path, "UNSAFE_OBJECT");
          return BAD;
        }
        const fieldPath = DIAGNOSTIC_PATH_FIELDS.has(key) ? `${path}.${key}` : path;
        const item = visit(descriptor.value, fieldPath, depth + 1);
        if (item === BAD) return BAD;
        output[key] = item;
      }
      return Object.freeze(output);
    } catch {
      issues.add(path, "UNSAFE_OBJECT");
      return BAD;
    } finally {
      active.delete(value);
    }
  }

  return visit(input, "$", 0);
}

export function object(
  value: unknown,
  path: string,
  keys: readonly string[],
  required: readonly string[],
  issues: Diagnostics,
): value is DataObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.add(path, "INVALID_TYPE");
    return false;
  }
  const source = value as DataObject;
  for (const key of Object.keys(source)) {
    if (!keys.includes(key)) issues.add(path, "UNEXPECTED_FIELD");
  }
  for (const key of required) {
    if (!Object.hasOwn(source, key)) issues.add(`${path}.${key}`, "MISSING_FIELD");
  }
  return true;
}

export function choice(
  value: unknown,
  choices: readonly string[],
  path: string,
  issues: Diagnostics,
): boolean {
  if (typeof value !== "string" || !choices.includes(value)) {
    issues.add(path, "INVALID_VALUE");
    return false;
  }
  return true;
}

export function identifier(value: unknown, path: string, issues: Diagnostics): boolean {
  if (
    typeof value !== "string" ||
    value.length > CONTRACT_LIMITS.maxIdentifierLength ||
    !/^[A-Za-z][A-Za-z0-9._-]*$/.test(value)
  ) {
    issues.add(path, "INVALID_VALUE");
    return false;
  }
  return true;
}

export function revision(value: unknown, path: string, issues: Diagnostics): void {
  if (identifier(value, path, issues) && (value as string).toLowerCase() === "latest") {
    issues.add(path, "INVALID_VALUE");
  }
}

export function digest(value: unknown, path: string, issues: Diagnostics): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    issues.add(path, "INVALID_VALUE");
  }
}

export function textValue(value: unknown, path: string, issues: Diagnostics): void {
  if (typeof value !== "string") issues.add(path, "INVALID_TYPE");
}

export function numberValue(value: unknown, path: string, issues: Diagnostics, nonnegative = false): void {
  if (typeof value !== "number" || !Number.isFinite(value) || (nonnegative && value < 0)) {
    issues.add(path, "INVALID_VALUE");
  }
}

export function list(
  value: unknown,
  path: string,
  issues: Diagnostics,
  max: number = CONTRACT_LIMITS.maxArrayLength,
): value is readonly unknown[] {
  if (!Array.isArray(value)) {
    issues.add(path, "INVALID_TYPE");
    return false;
  }
  if (value.length > max) {
    issues.add(path, "TOO_MANY_ITEMS");
    return false;
  }
  return true;
}

export function unique(values: readonly unknown[], path: string, issues: Diagnostics): void {
  const seen = new Set<unknown>();
  for (const [i, value] of values.entries()) {
    if (seen.has(value)) issues.add(`${path}[${i}]`, "DUPLICATE_ID");
    seen.add(value);
  }
}

function scalarType(
  value: unknown,
  itemType: SetItemType,
  path: string,
  issues: Diagnostics,
): void {
  if (typeof value !== itemType || (itemType === "number" && !Number.isFinite(value))) {
    issues.add(path, "INVALID_TYPE");
  }
}

export function setItems(value: unknown, itemType: unknown, path: string, issues: Diagnostics): void {
  if (!list(value, path, issues, CONTRACT_LIMITS.maxSetItems)) return;
  if (itemType === "string" || itemType === "number" || itemType === "boolean") {
    for (const [i, item] of value.entries()) scalarType(item, itemType, `${path}[${i}]`, issues);
  }
}

export function definitionRef(value: unknown, path: string, issues: Diagnostics): void {
  if (
    !object(
      value,
      path,
      ["assessmentId", "revision", "revisionDigest"],
      ["assessmentId", "revision", "revisionDigest"],
      issues,
    )
  )
    return;
  identifier(value.assessmentId, `${path}.assessmentId`, issues);
  revision(value.revision, `${path}.revision`, issues);
  digest(value.revisionDigest, `${path}.revisionDigest`, issues);
}

export function finish<T>(
  input: unknown,
  domain: ValidationDomain,
  check: (data: unknown, issues: Diagnostics) => void,
): ValidationResult<T> {
  const issues = new Diagnostics();
  const data = snapshot(input, issues);
  if (data === BAD) return issues.result(domain, undefined as T);
  check(data, issues);
  return issues.result(domain, data as T);
}
