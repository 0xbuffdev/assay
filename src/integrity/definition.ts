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
/** Historical schema-1 profile; schema-2 definitions use v2. */
export const ASSAY_DEFINITION_DIGEST_VERSION = "v1" as const;
const DOMAINS = {
  1: "assay:definition:v1\n",
  2: "assay:definition:v2\n",
} as const;
const encoder = new TextEncoder();

function hashDraft(draft: AssessmentDefinitionDraft): string {
  return sha256(encoder.encode(DOMAINS[draft.schemaVersion] + canonical(draft)));
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
  const { revisionDigest, ...draft } = checked.value;
  if (revisionDigest !== hashDraft(draft)) {
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
