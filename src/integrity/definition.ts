import type { AssessmentDefinition, AssessmentDefinitionDraft } from "../contracts/definition";
import type { ValidationResult } from "../contracts/validation";
import { DEFINITION_DOMAIN } from "../contracts/version";
import {
  parseAssessmentDefinition,
  parseAssessmentDefinitionDraft,
} from "../validation/definition";
import { canonical } from "./canonical";
import { sha256 } from "./sha256";

/** Current-generation definition content identity; never reinterpret old bytes. */
const encoder = new TextEncoder();

function hashDraft(draft: AssessmentDefinitionDraft): string {
  return sha256(encoder.encode(DEFINITION_DOMAIN + canonical(draft)));
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
