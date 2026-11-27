import type { ASSAY_SCHEMA_VERSION } from "../contracts/common";
import type { AssessmentDefinition, AssessmentDefinitionDraft } from "../contracts/definition";
import type { ValidationResult } from "../contracts/validation";
import {
  parseAssessmentDefinition,
  parseAssessmentDefinitionDraft,
} from "../validation/definition";
import { canonical } from "./canonical";
import { sha256 } from "./sha256";

/**
 * Persistent schema-to-digest binding: schemaVersion: 1 ALWAYS uses digest v1.
 * Any change to the digest algorithm or canonical bytes requires a NEW schema
 * version. Never reinterpret an existing schema-1 record using a new profile.
 * This content identity does not authenticate a publisher or evidence origin.
 * See docs/integrity.md for the normative byte-level profile.
 */
export const ASSAY_DEFINITION_DIGEST_VERSION = "v1" as const;
const DIGEST_V1_SCHEMA_VERSION: typeof ASSAY_SCHEMA_VERSION = 1;
const DOMAIN = "assay:definition:v1\n";
const encoder = new TextEncoder();

function hashDraft(draft: AssessmentDefinitionDraft): string {
  if (draft.schemaVersion !== DIGEST_V1_SCHEMA_VERSION) {
    throw new TypeError("Unsupported definition digest profile");
  }
  return sha256(encoder.encode(DOMAIN + canonical(draft)));
}

/** Calculate a versioned content hash from a validated unsigned definition. */
export function computeDefinitionDigest(draftInput: unknown): ValidationResult<string> {
  const checked = parseAssessmentDefinitionDraft(draftInput);
  if (!checked.ok) return checked;
  return Object.freeze({ ok: true, value: hashDraft(checked.value) });
}

/** Construct a frozen, bounded, content-bound definition from an unsigned draft. */
export function createAssessmentDefinition(
  draftInput: unknown,
): ValidationResult<AssessmentDefinition> {
  const checked = parseAssessmentDefinitionDraft(draftInput);
  if (!checked.ok) return checked;
  return parseAssessmentDefinition({
    ...checked.value,
    revisionDigest: hashDraft(checked.value),
  });
}

/** Verify content integrity only; the host must authenticate the publisher. */
export function verifyAssessmentDefinition(
  definitionInput: unknown,
): ValidationResult<AssessmentDefinition> {
  const checked = parseAssessmentDefinition(definitionInput);
  if (!checked.ok) return checked;
  const value = checked.value;
  const draft: AssessmentDefinitionDraft = {
    schemaVersion: value.schemaVersion,
    assessmentId: value.assessmentId,
    revision: value.revision,
    policyVersion: value.policyVersion,
    criteria: value.criteria,
  };
  if (value.revisionDigest !== hashDraft(draft)) {
    return Object.freeze({
      ok: false,
      domain: "invalid_definition",
      diagnostics: Object.freeze([
        Object.freeze({
          path: "$.revisionDigest",
          code: "DEFINITION_DIGEST_MISMATCH",
        }),
      ]),
    });
  }
  return checked;
}
