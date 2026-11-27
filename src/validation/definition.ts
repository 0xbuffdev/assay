import { ASSAY_SCHEMA_VERSION, CONTRACT_LIMITS } from "../contracts/common";
import type { AssessmentDefinition, AssessmentDefinitionDraft } from "../contracts/definition";
import type { ValidationResult } from "../contracts/validation";
import { validateComposition } from "./composition";
import {
  BAD,
  booleanValue,
  choice,
  type DataObject,
  Diagnostics,
  digest,
  finish,
  identifier,
  list,
  numberValue,
  object,
  rangeValue,
  revision,
  setItems,
  snapshot,
  textValue,
  unique,
} from "./shared";

function expected(
  value: unknown,
  visibility: unknown,
  path: string,
  kind: "text" | "number" | "set" | "boolean" | "range" | "json",
  itemType: unknown,
  referenceIds: Set<string>,
  issues: Diagnostics,
): void {
  const allowed = ["type", "value", "referenceId", "referenceDigest"];
  if (!object(value, path, allowed, ["type"], issues)) return;
  if (value.type === "reference") {
    const keys = ["type", "referenceId", "referenceDigest"];
    object(value, path, keys, keys, issues);
    identifier(value.referenceId, `${path}.referenceId`, issues);
    digest(value.referenceDigest, `${path}.referenceDigest`, issues);
    if (typeof value.referenceId === "string") {
      if (referenceIds.has(value.referenceId)) issues.add(`${path}.referenceId`, "DUPLICATE_ID");
      referenceIds.add(value.referenceId);
    }
    return;
  }
  if (value.type === "literal") {
    object(value, path, ["type", "value"], ["type", "value"], issues);
    if (visibility === "restricted") issues.add(path, "RESTRICTED_LITERAL");
    if (kind === "text") textValue(value.value, `${path}.value`, issues);
    if (kind === "number") numberValue(value.value, `${path}.value`, issues);
    if (kind === "set") setItems(value.value, itemType, `${path}.value`, issues);
    if (kind === "boolean") booleanValue(value.value, `${path}.value`, issues);
    if (kind === "range") rangeValue(value.value, `${path}.value`, issues);
    // A successful snapshot already guarantees a bounded JSON value.
    return;
  }
  issues.add(`${path}.type`, "INVALID_VALUE");
}

function parameters(
  criterion: DataObject,
  path: string,
  referenceIds: Set<string>,
  issues: Diagnostics,
): void {
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
    expected(
      value.expected,
      criterion.visibility,
      `${p}.expected`,
      "text",
      undefined,
      referenceIds,
      issues,
    );
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
    expected(
      value.expected,
      criterion.visibility,
      `${p}.expected`,
      "number",
      undefined,
      referenceIds,
      issues,
    );
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
  if (
    criterion.kind === "boolean_equality" ||
    criterion.kind === "number_range" ||
    criterion.kind === "json_equality"
  ) {
    const range = criterion.kind === "number_range";
    if (!object(value, p, range ? ["expected", "unit"] : ["expected"], ["expected"], issues))
      return;
    expected(
      value.expected,
      criterion.visibility,
      `${p}.expected`,
      range ? "range" : criterion.kind === "boolean_equality" ? "boolean" : "json",
      undefined,
      referenceIds,
      issues,
    );
    if (range && Object.hasOwn(value, "unit")) identifier(value.unit, `${p}.unit`, issues);
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
    expected(
      value.expected,
      criterion.visibility,
      `${p}.expected`,
      "set",
      value.itemType,
      referenceIds,
      issues,
    );
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
  if (criterion.kind === "qualitative_review") {
    if (criterion.mode !== "advisory") issues.add(`${path}.mode`, "INVALID_VALUE");
    const fields = ["reviewPolicyId", "reviewPolicyVersion"];
    if (object(value, p, fields, fields, issues)) {
      identifier(value.reviewPolicyId, `${p}.reviewPolicyId`, issues);
      revision(value.reviewPolicyVersion, `${p}.reviewPolicyVersion`, issues);
    }
    return;
  }
  if (criterion.kind === "manual_evidence") {
    if (object(value, p, ["review"], ["review"], issues)) {
      choice(value.review, ["required"], `${p}.review`, issues);
    }
  }
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
          "composition",
        ],
        [
          "schemaVersion",
          "assessmentId",
          "revision",
          "revisionDigest",
          "policyVersion",
          "criteria",
          "composition",
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
    choice(data.policyVersion, ["composed-required-v1"], "$.policyVersion", issues);
    if (!list(data.criteria, "$.criteria", issues, CONTRACT_LIMITS.maxCriteria)) return;
    if (data.criteria.length === 0) issues.add("$.criteria", "EMPTY_REQUIRED_CRITERIA");
    const ids: unknown[] = [];
    const referenceIds = new Set<string>();
    let required = 0;
    for (const [i, criterion] of data.criteria.entries()) {
      const path = `$.criteria[${i}]`;
      if (
        !object(
          criterion,
          path,
          ["id", "mode", "kind", "visibility", "parameters", "executionFact"],
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
            "boolean_equality",
            "number_range",
            "json_equality",
            "observed_execution",
            "manual_evidence",
            "qualitative_review",
          ],
          `${path}.kind`,
          issues,
        )
      ) {
        parameters(criterion, path, referenceIds, issues);
        if (Object.hasOwn(criterion, "executionFact")) {
          const kind = criterion.kind;
          const selectors =
            kind === "exact_text" || kind === "normalized_text"
              ? ["stdout", "stderr"]
              : kind === "number_with_tolerance" || kind === "number_range"
                ? ["exit_status"]
                : kind === "boolean_equality"
                  ? ["boolean_property"]
                  : kind === "json_equality"
                    ? ["structured_stdout", "structured_stderr"]
                    : [];
          choice(criterion.executionFact, selectors, `${path}.executionFact`, issues);
          if (
            criterion.executionFact === "exit_status" &&
            criterion.parameters &&
            typeof criterion.parameters === "object" &&
            Object.hasOwn(criterion.parameters, "unit")
          ) {
            issues.add(`${path}.parameters.unit`, "UNEXPECTED_FIELD");
          }
        }
      }
      ids.push(criterion.id);
      if (criterion.mode === "required") required++;
    }
    unique(ids, "$.criteria", issues);
    validateComposition(data.composition, data.criteria, issues);
    if (data.criteria.length > 0 && required === 0)
      issues.add("$.criteria", "EMPTY_REQUIRED_CRITERIA");
  });
}

/**
 * Parse an unsigned, authored definition without accepting an asserted digest.
 * Snapshot first: neither authoring nor verification may execute input getters.
 */
export function parseAssessmentDefinitionDraft(
  input: unknown,
): ValidationResult<AssessmentDefinitionDraft> {
  const issues = new Diagnostics();
  const data = snapshot(input, issues);
  if (data === BAD) {
    return issues.result("invalid_definition", undefined as unknown as AssessmentDefinitionDraft);
  }
  if (
    !object(
      data,
      "$",
      ["schemaVersion", "assessmentId", "revision", "policyVersion", "criteria", "composition"],
      ["schemaVersion", "assessmentId", "revision", "policyVersion", "criteria", "composition"],
      issues,
    )
  ) {
    return issues.result("invalid_definition", undefined as unknown as AssessmentDefinitionDraft);
  }
  if (data.schemaVersion !== ASSAY_SCHEMA_VERSION) {
    issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
  }
  if (issues.entries.length > 0) {
    return issues.result("invalid_definition", undefined as unknown as AssessmentDefinitionDraft);
  }

  // Reuse the full definition validator, including semantic parameter checks;
  // the fixed syntactically valid placeholder is discarded before returning.
  const checked = parseAssessmentDefinition({
    ...data,
    revisionDigest: `sha256:${"0".repeat(64)}`,
  });
  if (!checked.ok) return checked;
  const { revisionDigest: _digest, ...draft } = checked.value;
  return Object.freeze({ ok: true, value: Object.freeze(draft) });
}
