import { ASSAY_SCHEMA_VERSION, CONTRACT_LIMITS } from "../contracts/common";
import type { AssessmentDefinition } from "../contracts/definition";
import type { EvidenceBundle, Observation } from "../contracts/evidence";
import type {
  ObservationCollectionResult,
  ObservationPort,
  ObservationPortCriterion,
  ObservationPortKind,
  ObservationPortReceipt,
  ObservationPortRequest,
} from "../contracts/observation";
import type { DiagnosticCode } from "../contracts/validation";
import { inspectEvidenceCoverage } from "../validation/coverage";
import { parseAssessmentDefinition } from "../validation/definition";
import { parseEvidenceBundle } from "../validation/evidence";
import { parseObservationPortReport } from "../validation/observation";

function requestedKind(
  criterion: AssessmentDefinition["criteria"][number],
): ObservationPortKind | null {
  switch (criterion.kind) {
    case "exact_text":
    case "normalized_text":
      return "text";
    case "number_with_tolerance":
      return "number";
    case "set_equivalence":
      return "set";
    case "observed_execution":
      return "execution";
    case "manual_evidence":
      return null;
  }
}

function error(
  outcome: "invalid_definition" | "invalid_evidence",
  diagnostics: readonly { path: string; code: DiagnosticCode }[],
): ObservationCollectionResult {
  return Object.freeze({ ok: false, outcome, diagnostics });
}

function invalidEvidence(path: string, code: DiagnosticCode): ObservationCollectionResult {
  return error("invalid_evidence", Object.freeze([Object.freeze({ path, code })]));
}

function sameDefinition(
  expected: AssessmentDefinition,
  actual: EvidenceBundle["definition"],
): boolean {
  return (
    expected.assessmentId === actual.assessmentId &&
    expected.revision === actual.revision &&
    expected.revisionDigest === actual.revisionDigest
  );
}

/**
 * Optionally ask a caller-injected provider to produce bounded typed facts.
 *
 * This function has no built-in execution backend, network access, reference
 * resolution, or trust-verification authority. Caller-supplied adapter metadata
 * and run IDs are claims; they must be attested by the host before formal use.
 *
 * Only missing PUBLIC objective/execution criterion IDs are sent to the port.
 * No expected literal/reference value, hidden assertion reference, source
 * snippet or restricted criterion is sent. The port cannot overwrite existing
 * observations or supply unsolicited observations.
 */
export async function collectObservations(
  definitionInput: unknown,
  evidenceInput: unknown,
  port: ObservationPort,
): Promise<ObservationCollectionResult> {
  const checkedDefinition = parseAssessmentDefinition(definitionInput);
  if (!checkedDefinition.ok) return error("invalid_definition", checkedDefinition.diagnostics);

  const checkedEvidence = parseEvidenceBundle(evidenceInput);
  if (!checkedEvidence.ok) return error("invalid_evidence", checkedEvidence.diagnostics);

  const definition = checkedDefinition.value;
  const evidence = checkedEvidence.value;
  const coverage = inspectEvidenceCoverage(definition, evidence);
  if (!coverage.ok) return error("invalid_evidence", coverage.diagnostics);

  const existing = new Set(evidence.observations.map((item) => item.criterionId));
  const criteria: ObservationPortCriterion[] = [];
  for (const criterion of definition.criteria) {
    if (criterion.visibility !== "public" || existing.has(criterion.id)) continue;
    const kind = requestedKind(criterion);
    if (!kind) continue;
    const requested: ObservationPortCriterion = Object.freeze({
      criterionId: criterion.id,
      kind,
      ...(criterion.kind === "number_with_tolerance" && criterion.parameters.unit !== undefined
        ? { unit: criterion.parameters.unit }
        : {}),
      ...(criterion.kind === "observed_execution"
        ? { assertionIds: Object.freeze(criterion.parameters.assertions.map((a) => a.id)) }
        : {}),
    });
    criteria.push(requested);
  }

  // No request is made when all evidence exists or only restricted/manual
  // criteria lack evidence. In particular, no hidden test cases are exposed.
  if (criteria.length === 0) {
    return Object.freeze({ ok: true, evidence, receipt: null });
  }

  const request: ObservationPortRequest = Object.freeze({
    schemaVersion: ASSAY_SCHEMA_VERSION,
    definition: Object.freeze({
      assessmentId: definition.assessmentId,
      revision: definition.revision,
      revisionDigest: definition.revisionDigest,
    }),
    ...(evidence.artifactDigest ? { artifactDigest: evidence.artifactDigest } : {}),
    criteria: Object.freeze(criteria),
    limits: Object.freeze({ maxCapturedBytes: CONTRACT_LIMITS.maxCapturedBytes }),
  });

  let unknownReport: unknown;
  try {
    unknownReport = await port.observe(request);
  } catch {
    // Do not reveal thrown provider messages, stacks, tokens or raw output.
    return Object.freeze({
      ok: false,
      outcome: "evaluation_error",
      reasonCode: "OBSERVATION_PORT_ERROR",
    });
  }

  const checkedReport = parseObservationPortReport(unknownReport);
  if (!checkedReport.ok) return error("invalid_evidence", checkedReport.diagnostics);
  const report = checkedReport.value;

  if (!sameDefinition(definition, report.definition)) {
    return invalidEvidence("$.definition", "MISMATCHED_DEFINITION");
  }
  if (evidence.artifactDigest !== undefined && evidence.artifactDigest !== report.artifactDigest) {
    return invalidEvidence("$.artifactDigest", "MISMATCHED_DEFINITION");
  }

  const allowed = new Map(criteria.map((criterion) => [criterion.criterionId, criterion]));
  const returned: Observation[] = [];
  const truncated = report.provenance.stdoutTruncated || report.provenance.stderrTruncated;
  for (const [index, observation] of report.observations.entries()) {
    const criterion = allowed.get(observation.criterionId);
    const path = `$.observations[${index}]`;
    if (!criterion) return invalidEvidence(`${path}.criterionId`, "UNKNOWN_CRITERION");
    if (criterion.kind !== observation.kind) {
      return invalidEvidence(`${path}.kind`, "MISMATCHED_OBSERVATION");
    }
    if (observation.kind === "execution") {
      if (report.provenance.runRef !== observation.runRef) {
        return invalidEvidence(`${path}.runRef`, "MISMATCHED_OBSERVATION");
      }
      const ids = new Set(criterion.assertionIds ?? []);
      for (const [i, assertion] of observation.assertions.entries()) {
        if (!ids.has(assertion.assertionId)) {
          return invalidEvidence(`${path}.assertions[${i}].assertionId`, "UNKNOWN_CRITERION");
        }
      }
    }
    // Incomplete captured output cannot be promoted to complete evidence.
    returned.push(
      Object.freeze({
        ...observation,
        completeness: truncated ? "truncated" : observation.completeness,
      }) as Observation,
    );
  }

  const combined: EvidenceBundle = {
    schemaVersion: ASSAY_SCHEMA_VERSION,
    definition: evidence.definition,
    ...(report.artifactDigest ? { artifactDigest: report.artifactDigest } : {}),
    observations: [...evidence.observations, ...returned],
  };
  const parsedCombined = parseEvidenceBundle(combined);
  if (!parsedCombined.ok) return error("invalid_evidence", parsedCombined.diagnostics);
  const consistency = inspectEvidenceCoverage(definition, parsedCombined.value);
  if (!consistency.ok) return error("invalid_evidence", consistency.diagnostics);

  const receipt: ObservationPortReceipt = Object.freeze({
    definition: report.definition,
    ...(report.artifactDigest ? { artifactDigest: report.artifactDigest } : {}),
    provenance: report.provenance,
  });
  return Object.freeze({
    ok: true,
    evidence: parsedCombined.value,
    receipt,
  });
}
