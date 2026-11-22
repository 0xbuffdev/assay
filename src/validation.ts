import {
  ASSAY_SCHEMA_VERSION,
  type AssessmentDefinition,
  CONTRACT_LIMITS,
  type Criterion,
  type DiagnosticCode,
  type EvaluationResult,
  type EvidenceBundle,
  type EvidenceCoverage,
  type Observation,
  type ObservationPortReport,
  type SetItemType,
  type ValidationDiagnostic,
  type ValidationDomain,
  type ValidationResult,
} from "./contracts";

type DataObject = Record<string, unknown>;
const BAD = Symbol("invalid");
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

class Diagnostics {
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
function snapshot(input: unknown, issues: Diagnostics): unknown | typeof BAD {
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

function object(
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

function choice(
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

function identifier(value: unknown, path: string, issues: Diagnostics): boolean {
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

function revision(value: unknown, path: string, issues: Diagnostics): void {
  if (identifier(value, path, issues) && (value as string).toLowerCase() === "latest") {
    issues.add(path, "INVALID_VALUE");
  }
}

function digest(value: unknown, path: string, issues: Diagnostics): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    issues.add(path, "INVALID_VALUE");
  }
}

function textValue(value: unknown, path: string, issues: Diagnostics): void {
  if (typeof value !== "string") issues.add(path, "INVALID_TYPE");
}

function numberValue(value: unknown, path: string, issues: Diagnostics, nonnegative = false): void {
  if (typeof value !== "number" || !Number.isFinite(value) || (nonnegative && value < 0)) {
    issues.add(path, "INVALID_VALUE");
  }
}

function list(
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

function unique(values: readonly unknown[], path: string, issues: Diagnostics): void {
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

function setItems(value: unknown, itemType: unknown, path: string, issues: Diagnostics): void {
  if (!list(value, path, issues, CONTRACT_LIMITS.maxSetItems)) return;
  if (itemType === "string" || itemType === "number" || itemType === "boolean") {
    for (const [i, item] of value.entries()) scalarType(item, itemType, `${path}[${i}]`, issues);
  }
}

function expected(
  value: unknown,
  visibility: unknown,
  path: string,
  kind: "text" | "number" | "set",
  itemType: unknown,
  issues: Diagnostics,
): void {
  if (!object(value, path, ["type", "value", "referenceId"], ["type"], issues)) return;
  if (value.type === "reference") {
    object(value, path, ["type", "referenceId"], ["type", "referenceId"], issues);
    identifier(value.referenceId, `${path}.referenceId`, issues);
    return;
  }
  if (value.type === "literal") {
    object(value, path, ["type", "value"], ["type", "value"], issues);
    if (visibility === "restricted") issues.add(path, "RESTRICTED_LITERAL");
    if (kind === "text") textValue(value.value, `${path}.value`, issues);
    if (kind === "number") numberValue(value.value, `${path}.value`, issues);
    if (kind === "set") setItems(value.value, itemType, `${path}.value`, issues);
    return;
  }
  issues.add(`${path}.type`, "INVALID_VALUE");
}

function parameters(criterion: DataObject, path: string, issues: Diagnostics): void {
  const value = criterion.parameters;
  const p = `${path}.parameters`;
  if (criterion.kind === "exact_text" || criterion.kind === "normalized_text") {
    const normalized = criterion.kind === "normalized_text";
    if (
      !object(
        value,
        p,
        normalized ? ["expected", "normalization"] : ["expected"],
        normalized ? ["expected", "normalization"] : ["expected"],
        issues,
      )
    )
      return;
    expected(value.expected, criterion.visibility, `${p}.expected`, "text", undefined, issues);
    if (normalized) {
      const n = value.normalization;
      const np = `${p}.normalization`;
      if (
        !object(
          n,
          np,
          ["lineEndings", "unicode", "case", "whitespace", "trim"],
          ["lineEndings", "unicode", "case", "whitespace", "trim"],
          issues,
        )
      )
        return;
      choice(n.lineEndings, ["preserve", "lf"], `${np}.lineEndings`, issues);
      choice(n.unicode, ["none", "NFC", "NFKC"], `${np}.unicode`, issues);
      choice(n.case, ["sensitive", "fold"], `${np}.case`, issues);
      choice(n.whitespace, ["preserve", "collapse"], `${np}.whitespace`, issues);
      choice(n.trim, ["none", "both"], `${np}.trim`, issues);
    }
    return;
  }
  if (criterion.kind === "number_with_tolerance") {
    if (!object(value, p, ["expected", "tolerance", "unit"], ["expected", "tolerance"], issues))
      return;
    expected(value.expected, criterion.visibility, `${p}.expected`, "number", undefined, issues);
    const tolerance = value.tolerance;
    if (
      object(
        tolerance,
        `${p}.tolerance`,
        ["absolute", "relative"],
        ["absolute", "relative"],
        issues,
      )
    ) {
      numberValue(tolerance.absolute, `${p}.tolerance.absolute`, issues, true);
      numberValue(tolerance.relative, `${p}.tolerance.relative`, issues, true);
    }
    if (Object.hasOwn(value, "unit")) identifier(value.unit, `${p}.unit`, issues);
    return;
  }
  if (criterion.kind === "set_equivalence") {
    if (
      !object(
        value,
        p,
        ["expected", "itemType", "order", "duplicates"],
        ["expected", "itemType", "order", "duplicates"],
        issues,
      )
    )
      return;
    choice(value.itemType, ["string", "number", "boolean"], `${p}.itemType`, issues);
    choice(value.order, ["ignore", "preserve"], `${p}.order`, issues);
    choice(value.duplicates, ["ignore", "respect"], `${p}.duplicates`, issues);
    expected(value.expected, criterion.visibility, `${p}.expected`, "set", value.itemType, issues);
    return;
  }
  if (criterion.kind === "observed_execution") {
    if (!object(value, p, ["assertions"], ["assertions"], issues)) return;
    if (!list(value.assertions, `${p}.assertions`, issues)) return;
    if (value.assertions.length === 0) issues.add(`${p}.assertions`, "INVALID_VALUE");
    const ids: unknown[] = [];
    for (const [i, assertion] of value.assertions.entries()) {
      const ap = `${p}.assertions[${i}]`;
      if (!object(assertion, ap, ["id", "referenceId"], ["id", "referenceId"], issues)) continue;
      identifier(assertion.id, `${ap}.id`, issues);
      identifier(assertion.referenceId, `${ap}.referenceId`, issues);
      ids.push(assertion.id);
    }
    unique(ids, `${p}.assertions`, issues);
    return;
  }
  if (criterion.kind === "manual_evidence") {
    if (object(value, p, ["review"], ["review"], issues)) {
      choice(value.review, ["required"], `${p}.review`, issues);
    }
  }
}

function definitionRef(value: unknown, path: string, issues: Diagnostics): void {
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

function finish<T>(
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

/** Validate and freeze a caller-authorized assessment definition. */
export function parseAssessmentDefinition(input: unknown): ValidationResult<AssessmentDefinition> {
  return finish(input, "invalid_definition", (data, issues) => {
    if (
      !object(
        data,
        "$",
        [
          "schemaVersion",
          "assessmentId",
          "revision",
          "revisionDigest",
          "policyVersion",
          "criteria",
        ],
        [
          "schemaVersion",
          "assessmentId",
          "revision",
          "revisionDigest",
          "policyVersion",
          "criteria",
        ],
        issues,
      )
    )
      return;
    if (data.schemaVersion !== ASSAY_SCHEMA_VERSION)
      issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    identifier(data.assessmentId, "$.assessmentId", issues);
    revision(data.revision, "$.revision", issues);
    digest(data.revisionDigest, "$.revisionDigest", issues);
    revision(data.policyVersion, "$.policyVersion", issues);
    if (!list(data.criteria, "$.criteria", issues, CONTRACT_LIMITS.maxCriteria)) return;
    if (data.criteria.length === 0) issues.add("$.criteria", "EMPTY_REQUIRED_CRITERIA");
    const ids: unknown[] = [];
    let required = 0;
    for (const [i, criterion] of data.criteria.entries()) {
      const path = `$.criteria[${i}]`;
      if (
        !object(
          criterion,
          path,
          ["id", "mode", "kind", "visibility", "parameters"],
          ["id", "mode", "kind", "visibility", "parameters"],
          issues,
        )
      )
        continue;
      identifier(criterion.id, `${path}.id`, issues);
      choice(criterion.mode, ["required", "advisory"], `${path}.mode`, issues);
      choice(criterion.visibility, ["public", "restricted"], `${path}.visibility`, issues);
      if (
        choice(
          criterion.kind,
          [
            "exact_text",
            "normalized_text",
            "number_with_tolerance",
            "set_equivalence",
            "observed_execution",
            "manual_evidence",
          ],
          `${path}.kind`,
          issues,
        )
      ) {
        parameters(criterion, path, issues);
      }
      ids.push(criterion.id);
      if (criterion.mode === "required") required++;
    }
    unique(ids, "$.criteria", issues);
    if (data.criteria.length > 0 && required === 0)
      issues.add("$.criteria", "EMPTY_REQUIRED_CRITERIA");
  });
}

/**
 * Validate evidence shape, never its authenticity or correctness.
 *
 * Zero/missing observations and truncated observations remain *valid evidence
 * structures*, so AY-I02 can report a technical "inconclusive" instead of
 * misrepresenting an absent answer as a malformed submission.
 */
export function parseEvidenceBundle(input: unknown): ValidationResult<EvidenceBundle> {
  return finish(input, "invalid_evidence", (data, issues) => {
    if (
      !object(
        data,
        "$",
        ["schemaVersion", "definition", "artifactDigest", "observations"],
        ["schemaVersion", "definition", "observations"],
        issues,
      )
    )
      return;
    if (data.schemaVersion !== ASSAY_SCHEMA_VERSION)
      issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    definitionRef(data.definition, "$.definition", issues);
    if (Object.hasOwn(data, "artifactDigest"))
      digest(data.artifactDigest, "$.artifactDigest", issues);
    if (!list(data.observations, "$.observations", issues, CONTRACT_LIMITS.maxObservations)) return;
    const ids: unknown[] = [];
    const refs: unknown[] = [];
    for (const [i, obs] of data.observations.entries()) {
      const p = `$.observations[${i}]`;
      if (
        !object(
          obs,
          p,
          [
            "criterionId",
            "evidenceRef",
            "completeness",
            "kind",
            "value",
            "itemType",
            "items",
            "runRef",
            "assertions",
            "artifactRefs",
          ],
          ["criterionId", "evidenceRef", "completeness", "kind"],
          issues,
        )
      )
        continue;
      identifier(obs.criterionId, `${p}.criterionId`, issues);
      identifier(obs.evidenceRef, `${p}.evidenceRef`, issues);
      choice(obs.completeness, ["complete", "truncated"], `${p}.completeness`, issues);
      ids.push(obs.criterionId);
      refs.push(obs.evidenceRef);
      if (obs.kind === "text") {
        object(
          obs,
          p,
          ["criterionId", "evidenceRef", "completeness", "kind", "value"],
          ["criterionId", "evidenceRef", "completeness", "kind", "value"],
          issues,
        );
        textValue(obs.value, `${p}.value`, issues);
      } else if (obs.kind === "number") {
        object(
          obs,
          p,
          ["criterionId", "evidenceRef", "completeness", "kind", "value", "unit"],
          ["criterionId", "evidenceRef", "completeness", "kind", "value"],
          issues,
        );
        numberValue(obs.value, `${p}.value`, issues);
        if (Object.hasOwn(obs, "unit")) identifier(obs.unit, `${p}.unit`, issues);
      } else if (obs.kind === "set") {
        object(
          obs,
          p,
          ["criterionId", "evidenceRef", "completeness", "kind", "itemType", "items"],
          ["criterionId", "evidenceRef", "completeness", "kind", "itemType", "items"],
          issues,
        );
        choice(obs.itemType, ["string", "number", "boolean"], `${p}.itemType`, issues);
        setItems(obs.items, obs.itemType, `${p}.items`, issues);
      } else if (obs.kind === "execution") {
        object(
          obs,
          p,
          ["criterionId", "evidenceRef", "completeness", "kind", "runRef", "assertions"],
          ["criterionId", "evidenceRef", "completeness", "kind", "runRef", "assertions"],
          issues,
        );
        identifier(obs.runRef, `${p}.runRef`, issues);
        if (!list(obs.assertions, `${p}.assertions`, issues)) continue;
        const assertionIds: unknown[] = [];
        for (const [j, assertion] of obs.assertions.entries()) {
          const ap = `${p}.assertions[${j}]`;
          if (!object(assertion, ap, ["assertionId", "state"], ["assertionId", "state"], issues))
            continue;
          identifier(assertion.assertionId, `${ap}.assertionId`, issues);
          choice(assertion.state, ["confirmed", "refuted", "unknown"], `${ap}.state`, issues);
          assertionIds.push(assertion.assertionId);
        }
        unique(assertionIds, `${p}.assertions`, issues);
      } else if (obs.kind === "manual") {
        object(
          obs,
          p,
          ["criterionId", "evidenceRef", "completeness", "kind", "artifactRefs"],
          ["criterionId", "evidenceRef", "completeness", "kind", "artifactRefs"],
          issues,
        );
        if (!list(obs.artifactRefs, `${p}.artifactRefs`, issues, CONTRACT_LIMITS.maxEvidenceRefs))
          continue;
        for (const [j, id] of obs.artifactRefs.entries())
          identifier(id, `${p}.artifactRefs[${j}]`, issues);
        unique(obs.artifactRefs, `${p}.artifactRefs`, issues);
      } else issues.add(`${p}.kind`, "INVALID_VALUE");
    }
    unique(ids, "$.observations", issues);
    unique(refs, "$.observations", issues);
  });
}

/** Validate a technical finding record without granting authority to its claim. */
export function parseEvaluationResult(input: unknown): ValidationResult<EvaluationResult> {
  return finish(input, "invalid_result", (data, issues) => {
    if (
      !object(
        data,
        "$",
        [
          "schemaVersion",
          "outcome",
          "definition",
          "policyVersion",
          "findings",
          "evaluator",
          "warnings",
        ],
        [
          "schemaVersion",
          "outcome",
          "definition",
          "policyVersion",
          "findings",
          "evaluator",
          "warnings",
        ],
        issues,
      )
    )
      return;
    if (data.schemaVersion !== ASSAY_SCHEMA_VERSION)
      issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    choice(
      data.outcome,
      [
        "pass",
        "fail",
        "inconclusive",
        "invalid_definition",
        "invalid_evidence",
        "evaluation_error",
      ],
      "$.outcome",
      issues,
    );
    definitionRef(data.definition, "$.definition", issues);
    revision(data.policyVersion, "$.policyVersion", issues);
    if (object(data.evaluator, "$.evaluator", ["id", "version"], ["id", "version"], issues)) {
      identifier(data.evaluator.id, "$.evaluator.id", issues);
      revision(data.evaluator.version, "$.evaluator.version", issues);
    }
    if (list(data.warnings, "$.warnings", issues, CONTRACT_LIMITS.maxEvidenceRefs)) {
      for (const [i, warning] of data.warnings.entries())
        reason(warning, `$.warnings[${i}]`, issues);
    }
    if (!list(data.findings, "$.findings", issues, CONTRACT_LIMITS.maxCriteria)) return;
    const ids: unknown[] = [];
    for (const [i, finding] of data.findings.entries()) {
      const p = `$.findings[${i}]`;
      if (
        !object(
          finding,
          p,
          [
            "criterionId",
            "outcome",
            "reasonCode",
            "evidenceRefs",
            "evaluatorId",
            "evaluatorVersion",
          ],
          [
            "criterionId",
            "outcome",
            "reasonCode",
            "evidenceRefs",
            "evaluatorId",
            "evaluatorVersion",
          ],
          issues,
        )
      )
        continue;
      identifier(finding.criterionId, `${p}.criterionId`, issues);
      choice(finding.outcome, ["pass", "fail", "inconclusive", "error"], `${p}.outcome`, issues);
      reason(finding.reasonCode, `${p}.reasonCode`, issues);
      identifier(finding.evaluatorId, `${p}.evaluatorId`, issues);
      revision(finding.evaluatorVersion, `${p}.evaluatorVersion`, issues);
      if (
        list(finding.evidenceRefs, `${p}.evidenceRefs`, issues, CONTRACT_LIMITS.maxEvidenceRefs)
      ) {
        for (const [j, id] of finding.evidenceRefs.entries())
          identifier(id, `${p}.evidenceRefs[${j}]`, issues);
        unique(finding.evidenceRefs, `${p}.evidenceRefs`, issues);
      }
      ids.push(finding.criterionId);
    }
    unique(ids, "$.findings", issues);
  });
}

function reason(value: unknown, path: string, issues: Diagnostics): void {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) {
    issues.add(path, "INVALID_VALUE");
  }
}

/**
 * Parse a port's bounded facts and claimed provenance without trusting any
 * boolean marker, provider name or reported run identifier.
 *
 * The outer envelope is checked here; AY-I01's evidence parser checks every
 * returned typed observation and rejects unknown observation fields.
 */
export function parseObservationPortReport(
  input: unknown,
): ValidationResult<ObservationPortReport> {
  return finish(input, "invalid_evidence", (data, issues) => {
    if (
      !object(
        data,
        "$",
        ["schemaVersion", "definition", "artifactDigest", "provenance", "observations"],
        ["schemaVersion", "definition", "provenance", "observations"],
        issues,
      )
    )
      return;

    if (data.schemaVersion !== ASSAY_SCHEMA_VERSION)
      issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    definitionRef(data.definition, "$.definition", issues);
    if (Object.hasOwn(data, "artifactDigest"))
      digest(data.artifactDigest, "$.artifactDigest", issues);

    const provenance = data.provenance;
    if (
      object(
        provenance,
        "$.provenance",
        [
          "adapterId",
          "adapterVersion",
          "runRef",
          "toolchainId",
          "toolchainVersion",
          "capturedStdoutBytes",
          "capturedStderrBytes",
          "stdoutTruncated",
          "stderrTruncated",
        ],
        [
          "adapterId",
          "adapterVersion",
          "runRef",
          "toolchainId",
          "toolchainVersion",
          "capturedStdoutBytes",
          "capturedStderrBytes",
          "stdoutTruncated",
          "stderrTruncated",
        ],
        issues,
      )
    ) {
      identifier(provenance.adapterId, "$.provenance.adapterId", issues);
      revision(provenance.adapterVersion, "$.provenance.adapterVersion", issues);
      identifier(provenance.runRef, "$.provenance.runRef", issues);
      identifier(provenance.toolchainId, "$.provenance.toolchainId", issues);
      revision(provenance.toolchainVersion, "$.provenance.toolchainVersion", issues);

      const captured = [provenance.capturedStdoutBytes, provenance.capturedStderrBytes];
      for (const [index, n] of captured.entries()) {
        const field = index === 0 ? "capturedStdoutBytes" : "capturedStderrBytes";
        if (
          typeof n !== "number" ||
          !Number.isSafeInteger(n) ||
          n < 0 ||
          n > CONTRACT_LIMITS.maxCapturedBytes
        ) {
          issues.add(`$.provenance.${field}`, "INVALID_VALUE");
        }
      }
      if (
        captured.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) &&
        (captured[0] as number) + (captured[1] as number) > CONTRACT_LIMITS.maxCapturedBytes
      ) {
        issues.add("$.provenance", "INPUT_TOO_LARGE");
      }
      if (typeof provenance.stdoutTruncated !== "boolean")
        issues.add("$.provenance.stdoutTruncated", "INVALID_TYPE");
      if (typeof provenance.stderrTruncated !== "boolean")
        issues.add("$.provenance.stderrTruncated", "INVALID_TYPE");
    }

    // Copy the already snapped fields through the same bounded observation
    // contract as direct evidence, including duplicate-ID protection.
    const reportEvidence = parseEvidenceBundle({
      schemaVersion: data.schemaVersion,
      definition: data.definition,
      ...(Object.hasOwn(data, "artifactDigest") ? { artifactDigest: data.artifactDigest } : {}),
      observations: data.observations,
    });
    if (!reportEvidence.ok) {
      for (const diagnostic of reportEvidence.diagnostics) {
        issues.add(diagnostic.path, diagnostic.code);
      }
    }
  });
}

/**
 * Inspect required evidence coverage only. This does not compare values,
 * declare correctness, or treat an unverified source as trusted.
 */
export function inspectEvidenceCoverage(
  definitionInput: unknown,
  evidenceInput: unknown,
): ValidationResult<EvidenceCoverage> {
  const definition = parseAssessmentDefinition(definitionInput);
  if (!definition.ok) return definition;
  const evidence = parseEvidenceBundle(evidenceInput);
  if (!evidence.ok) return evidence;
  const issues = new Diagnostics();
  const expected = definition.value;
  const actual = evidence.value;

  if (
    actual.definition.assessmentId !== expected.assessmentId ||
    actual.definition.revision !== expected.revision ||
    actual.definition.revisionDigest !== expected.revisionDigest
  ) {
    issues.add("$.definition", "MISMATCHED_DEFINITION");
  }
  const criteria = new Map<string, Criterion>(
    expected.criteria.map((criterion) => [criterion.id, criterion]),
  );
  const evidenceByCriterion = new Map<string, Observation>();
  for (const [i, observation] of actual.observations.entries()) {
    const criterion = criteria.get(observation.criterionId);
    const path = `$.observations[${i}]`;
    if (!criterion) {
      issues.add(`${path}.criterionId`, "UNKNOWN_CRITERION");
      continue;
    }
    const matchingKind =
      ((criterion.kind === "exact_text" || criterion.kind === "normalized_text") &&
        observation.kind === "text") ||
      (criterion.kind === "number_with_tolerance" &&
        observation.kind === "number" &&
        // Absent units are valid only when both sides deliberately omit them.
        criterion.parameters.unit === observation.unit) ||
      (criterion.kind === "set_equivalence" &&
        observation.kind === "set" &&
        criterion.parameters.itemType === observation.itemType) ||
      (criterion.kind === "observed_execution" && observation.kind === "execution") ||
      (criterion.kind === "manual_evidence" && observation.kind === "manual");
    if (!matchingKind) {
      if (
        criterion.kind === "number_with_tolerance" &&
        observation.kind === "number" &&
        criterion.parameters.unit !== observation.unit
      ) {
        issues.add(`${path}.unit`, "MISMATCHED_OBSERVATION");
      } else {
        issues.add(`${path}.kind`, "MISMATCHED_OBSERVATION");
      }
    }

    if (criterion.kind === "observed_execution" && observation.kind === "execution") {
      const known = new Set(criterion.parameters.assertions.map((assertion) => assertion.id));
      for (const [j, assertion] of observation.assertions.entries()) {
        if (!known.has(assertion.assertionId)) {
          issues.add(`${path}.assertions[${j}].assertionId`, "UNKNOWN_CRITERION");
        }
      }
    }
    evidenceByCriterion.set(criterion.id, observation);
  }
  const missingRequired: string[] = [];
  const incompleteRequired: string[] = [];
  for (const criterion of expected.criteria) {
    if (criterion.mode !== "required") continue;
    const obs = evidenceByCriterion.get(criterion.id);
    if (!obs) missingRequired.push(criterion.id);
    else {
      const missingExecutionAssertion =
        criterion.kind === "observed_execution" &&
        obs.kind === "execution" &&
        criterion.parameters.assertions.some(
          (expectedAssertion) =>
            !obs.assertions.some(
              (observedAssertion) =>
                observedAssertion.assertionId === expectedAssertion.id &&
                observedAssertion.state !== "unknown",
            ),
        );
      const missingManualArtifact =
        criterion.kind === "manual_evidence" &&
        obs.kind === "manual" &&
        obs.artifactRefs.length === 0;

      if (obs.completeness === "truncated" || missingExecutionAssertion || missingManualArtifact) {
        incompleteRequired.push(criterion.id);
      }
    }
  }
  return issues.result(
    "invalid_evidence",
    Object.freeze({
      missingRequired: Object.freeze(missingRequired),
      incompleteRequired: Object.freeze(incompleteRequired),
    }),
  );
}
