import { CONTRACT_LIMITS } from "../contracts/common";
import type { AssessmentDefinition } from "../contracts/definition";
import type { EvidenceBundle, Observation, ObservationOrigin } from "../contracts/evidence";
import type {
  ObservationCollectionResult,
  ObservationPort,
  ObservationPortCriterion,
  ObservationPortKind,
  ObservationPortReceipt,
  ObservationPortRequest,
} from "../contracts/observation";
import type { DiagnosticCode } from "../contracts/validation";
import { verifyAssessmentDefinition } from "../integrity/definition";
import { createEvidenceBundle, verifyEvidenceForDefinition } from "../integrity/evidence";
import { parseObservationPortReport } from "../validation/observation";

function requestedKind(
  criterion: AssessmentDefinition["criteria"][number],
): ObservationPortKind | null {
  switch (criterion.kind) {
    case "exact_text":
    case "normalized_text":
      return "text";
    case "boolean_equality":
      return "boolean";
    case "json_equality":
      return "json";
    case "number_range":
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
 * Definition integrity is checked before inspecting evidence or invoking the port.
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
  const checkedDefinition = verifyAssessmentDefinition(definitionInput);
  if (!checkedDefinition.ok) return error("invalid_definition", checkedDefinition.diagnostics);

  const definition = checkedDefinition.value;
  const checkedEvidence = verifyEvidenceForDefinition(definition, evidenceInput);
  if (!checkedEvidence.ok) return error("invalid_evidence", checkedEvidence.diagnostics);

  const evidence = checkedEvidence.value;

  const existing = new Set(evidence.observations.map((item) => item.criterionId));
  const criteria: ObservationPortCriterion[] = [];
  for (const criterion of definition.criteria) {
    if (criterion.visibility !== "public" || existing.has(criterion.id)) continue;
    // AY-I19 owns the explicit execution-fact request and report contract.
    if (criterion.executionFact !== undefined) continue;
    const kind = requestedKind(criterion);
    if (!kind) continue;
    const requested: ObservationPortCriterion = Object.freeze({
      criterionId: criterion.id,
      kind,
      ...((criterion.kind === "number_with_tolerance" || criterion.kind === "number_range") &&
      criterion.parameters.unit !== undefined
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
    schemaVersion: 2,
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

  if (
    evidence.artifactDigest === undefined &&
    report.artifactDigest !== undefined &&
    evidence.observations.length > 0
  ) {
    return invalidEvidence("$.artifactDigest", "MISMATCHED_ORIGIN");
  }

  const origin: ObservationOrigin = Object.freeze({
    ...(report.artifactDigest === undefined
      ? { kind: "independent" as const }
      : { kind: "artifact" as const, artifactDigest: report.artifactDigest }),
    sourceRef: report.provenance.adapterId,
    runRef: report.provenance.runRef,
    provenance: report.provenance,
  });
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
        origin,
        completeness: truncated ? "truncated" : observation.completeness,
      }) as Observation,
    );
  }

  const parsedCombined = createEvidenceBundle(definition, {
    schemaVersion: 2,
    ...(report.artifactDigest ? { artifactDigest: report.artifactDigest } : {}),
    observations: [...evidence.observations, ...returned],
  });
  if (!parsedCombined.ok) return error("invalid_evidence", parsedCombined.diagnostics);

  const receipt: ObservationPortReceipt = Object.freeze({
    definition: report.definition,
    evidenceDigest: parsedCombined.value.evidenceDigest,
    evidenceRefs: Object.freeze(returned.map((item) => item.evidenceRef)),
    ...(report.artifactDigest ? { artifactDigest: report.artifactDigest } : {}),
    provenance: report.provenance,
  });
  return Object.freeze({
    ok: true,
    evidence: parsedCombined.value,
    receipt,
  });
}
