import type { AssessmentDefinition } from "../contracts/definition";
import type { EvidenceBundle } from "../contracts/evidence";
import type { ValidationResult } from "../contracts/validation";
import { inspectValidatedCoverage } from "../validation/coverage";
import { parseEvidenceBundle, parseEvidenceBundleDraft } from "../validation/evidence";
import { Diagnostics } from "../validation/shared";
import { canonical } from "./canonical";
import { verifyAssessmentDefinition } from "./definition";
import { sha256 } from "./sha256";

const encoder = new TextEncoder();

function hashContent(content: Omit<EvidenceBundle, "evidenceDigest">): string {
  return sha256(encoder.encode(`assay:evidence:v2\n${canonical(content)}`));
}

/** Seal a bounded unsigned draft with lineage derived from a verified definition. */
export function createEvidenceBundle(
  definitionInput: unknown,
  draftInput: unknown,
): ValidationResult<EvidenceBundle> {
  const definition = verifyAssessmentDefinition(definitionInput);
  if (!definition.ok) return definition;
  const checked = parseEvidenceBundleDraft(draftInput);
  if (!checked.ok) return checked;
  const content = {
    ...checked.value,
    definition: {
      assessmentId: definition.value.assessmentId,
      revision: definition.value.revision,
      revisionDigest: definition.value.revisionDigest,
    },
  };
  const bounded = parseEvidenceBundle({
    ...content,
    evidenceDigest: `sha256:${"0".repeat(64)}`,
  });
  if (!bounded.ok) return bounded;
  const coverage = inspectValidatedCoverage(definition.value, bounded.value);
  if (!coverage.ok) return coverage;
  const { evidenceDigest: _placeholder, ...validatedContent } = bounded.value;
  return Object.freeze({
    ok: true,
    value: Object.freeze({ ...validatedContent, evidenceDigest: hashContent(validatedContent) }),
  });
}

/** Verify complete evidence content and lineage, never source authenticity. */
export function verifyEvidenceBundle(
  definitionInput: unknown,
  evidenceInput: unknown,
): ValidationResult<EvidenceBundle> {
  const definition = verifyAssessmentDefinition(definitionInput);
  if (!definition.ok) return definition;
  return verifyEvidenceForDefinition(definition.value, evidenceInput);
}

/** Internal boundary: definition is already content-verified. */
export function verifyEvidenceForDefinition(
  definition: AssessmentDefinition,
  evidenceInput: unknown,
): ValidationResult<EvidenceBundle> {
  const checked = parseEvidenceBundle(evidenceInput);
  if (!checked.ok) return checked;
  const { evidenceDigest, ...content } = checked.value;
  if (evidenceDigest !== hashContent(content)) {
    const issues = new Diagnostics();
    issues.add("$.evidenceDigest", "EVIDENCE_DIGEST_MISMATCH");
    return issues.result("invalid_evidence", checked.value);
  }
  const coverage = inspectValidatedCoverage(definition, checked.value);
  return coverage.ok ? checked : coverage;
}
