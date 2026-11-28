import type { AssessmentDefinition, Criterion } from "../contracts/definition";
import type {
  ReferenceBundle,
  ReferenceRecord,
  ReferenceRecordDraft,
} from "../contracts/reference";
import type { ValidationResult } from "../contracts/validation";
import { REFERENCE_DOMAIN } from "../contracts/version";
import {
  parseReferenceBundle,
  parseReferenceDraft,
  parseReferenceRecord,
} from "../validation/reference";
import { Diagnostics } from "../validation/shared";
import { canonical } from "./canonical";
import { verifyAssessmentDefinition } from "./definition";
import { sha256 } from "./sha256";

const encoder = new TextEncoder();

function hashDraft(draft: ReferenceRecordDraft): string {
  return sha256(encoder.encode(REFERENCE_DOMAIN + canonical(draft)));
}

/** Seal bounded typed expected content; the returned record is privileged. */
export function createReferenceRecord(input: unknown): ValidationResult<ReferenceRecord> {
  const checked = parseReferenceDraft(input);
  if (!checked.ok) return checked;
  return parseReferenceRecord({ ...checked.value, referenceDigest: hashDraft(checked.value) });
}

type ObjectiveCriterion = Extract<
  Criterion,
  {
    kind:
      | "exact_text"
      | "normalized_text"
      | "number_with_tolerance"
      | "set_equivalence"
      | "boolean_equality"
      | "number_range"
      | "json_equality";
  }
>;

function matchesKind(criterion: ObjectiveCriterion, record: ReferenceRecord): boolean {
  switch (criterion.kind) {
    case "exact_text":
    case "normalized_text":
      return record.kind === "text";
    case "number_with_tolerance":
      return record.kind === "number" && criterion.parameters.unit === record.unit;
    case "boolean_equality":
      return record.kind === "boolean";
    case "json_equality":
      return record.kind === "json";
    case "number_range":
      return record.kind === "range" && criterion.parameters.unit === record.unit;
    case "set_equivalence":
      return record.kind === "set" && criterion.parameters.itemType === record.itemType;
  }
}

/**
 * Verify supplied material against an exact current definition. An incomplete
 * bundle is allowed; validation does not resolve references or compare evidence.
 */
export function verifyReferenceBundle(
  definitionInput: unknown,
  bundleInput: unknown,
): ValidationResult<ReferenceBundle> {
  const checkedDefinition = verifyAssessmentDefinition(definitionInput);
  if (!checkedDefinition.ok) return checkedDefinition;
  return verifyReferencesForDefinition(checkedDefinition.value, bundleInput);
}

/** Internal boundary: the definition must already be content-verified and frozen. */
export function verifyReferencesForDefinition(
  definition: AssessmentDefinition,
  bundleInput: unknown,
): ValidationResult<ReferenceBundle> {
  const issues = new Diagnostics();
  const checked = parseReferenceBundle(bundleInput);
  if (!checked.ok) return checked;
  const bundle = checked.value;
  if (
    bundle.definition.assessmentId !== definition.assessmentId ||
    bundle.definition.revision !== definition.revision ||
    bundle.definition.revisionDigest !== definition.revisionDigest
  ) {
    issues.add("$.definition", "MISMATCHED_DEFINITION");
    return issues.result("invalid_reference", bundle);
  }

  const declared = new Map<string, ObjectiveCriterion>();
  for (const criterion of definition.criteria) {
    if (
      criterion.kind === "observed_execution" ||
      criterion.kind === "manual_evidence" ||
      criterion.kind === "qualitative_review"
    )
      continue;
    if (criterion.parameters.expected.type === "reference") {
      declared.set(criterion.parameters.expected.referenceId, criterion);
    }
  }
  for (const [i, record] of bundle.references.entries()) {
    const path = `$.references[${i}]`;
    const { referenceDigest, ...draft } = record;
    const criterion = declared.get(record.referenceId);
    if (referenceDigest !== hashDraft(draft)) {
      issues.add(`${path}.referenceDigest`, "REFERENCE_DIGEST_MISMATCH");
    }
    if (criterion?.parameters.expected.type !== "reference") {
      issues.add(`${path}.referenceId`, "UNKNOWN_REFERENCE");
      continue;
    }
    if (criterion.parameters.expected.referenceDigest !== referenceDigest) {
      issues.add(`${path}.referenceDigest`, "REFERENCE_DIGEST_MISMATCH");
    }
    if (!matchesKind(criterion, record)) issues.add(path, "MISMATCHED_REFERENCE");
  }
  return issues.result("invalid_reference", bundle);
}
