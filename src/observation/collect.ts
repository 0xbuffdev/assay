import { CONTRACT_LIMITS, captureTruncated } from "../contracts/common";
import type { AssessmentDefinition } from "../contracts/definition";
import type { EvidenceBundle } from "../contracts/evidence";
import type {
  ObservationCollectionOptions,
  ObservationCollectionResult,
  ObservationPort,
  ObservationPortCriterion,
  ObservationPortReceipt,
  ObservationPortRequest,
} from "../contracts/observation";
import type { DiagnosticCode } from "../contracts/validation";
import { verifyAssessmentDefinition } from "../integrity/definition";
import { createEvidenceBundle, verifyEvidenceForDefinition } from "../integrity/evidence";
import { parseObservationPortReport } from "../validation/observation";

function requestedCriterion(
  criterion: AssessmentDefinition["criteria"][number],
): ObservationPortCriterion | null {
  const criterionId = criterion.id;
  switch (criterion.kind) {
    case "exact_text":
    case "normalized_text":
      return criterion.executionFact === undefined
        ? { criterionId, kind: "text" }
        : { criterionId, kind: "text", executionFact: criterion.executionFact };
    case "boolean_equality":
      return criterion.executionFact === undefined
        ? { criterionId, kind: "boolean" }
        : { criterionId, kind: "boolean", executionFact: criterion.executionFact };
    case "json_equality":
      return criterion.executionFact === undefined
        ? { criterionId, kind: "json" }
        : { criterionId, kind: "json", executionFact: criterion.executionFact };
    case "number_range":
    case "number_with_tolerance":
      return criterion.executionFact === undefined
        ? {
            criterionId,
            kind: "number",
            ...(criterion.parameters.unit === undefined ? {} : { unit: criterion.parameters.unit }),
          }
        : { criterionId, kind: "number", executionFact: criterion.executionFact };
    case "set_equivalence":
      return { criterionId, kind: "set", itemType: criterion.parameters.itemType };
    case "observed_execution":
      return {
        criterionId,
        kind: "execution",
        assertionIds: Object.freeze(criterion.parameters.assertions.map((a) => a.id)),
      };
    case "manual_evidence":
      return null;
  }
}

type PortFailure = Extract<ObservationCollectionResult, { outcome: "evaluation_error" }>;

function acquisitionFailure(reasonCode: PortFailure["reasonCode"]): PortFailure {
  return Object.freeze({ ok: false, outcome: "evaluation_error", reasonCode });
}

type Acquisition = Readonly<{ ok: true; report: unknown }> | PortFailure;

function acquire(
  port: ObservationPort,
  request: ObservationPortRequest,
  signal: AbortSignal | undefined,
): Promise<Acquisition> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Acquisition): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = (): void => finish(acquisitionFailure("OBSERVATION_CANCELLED"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      // Attach both handlers even if the provider synchronously triggers abort.
      // A noncooperative provider may settle long after collection has returned.
      void Promise.resolve(port.observe(request, signal)).then(
        (report) => finish({ ok: true, report }),
        () => finish(acquisitionFailure("OBSERVATION_PORT_ERROR")),
      );
    } catch {
      finish(acquisitionFailure("OBSERVATION_PORT_ERROR"));
    }
  });
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
  options: ObservationCollectionOptions = {},
): Promise<ObservationCollectionResult> {
  const checkedDefinition = verifyAssessmentDefinition(definitionInput);
  if (!checkedDefinition.ok) return error("invalid_definition", checkedDefinition.diagnostics);

  const definition = checkedDefinition.value;
  const checkedEvidence = verifyEvidenceForDefinition(definition, evidenceInput);
  if (!checkedEvidence.ok) return error("invalid_evidence", checkedEvidence.diagnostics);

  const evidence = checkedEvidence.value;
  const signal = options.signal;
  if (signal?.aborted) return acquisitionFailure("OBSERVATION_CANCELLED");

  const existing = new Set(evidence.observations.map((item) => item.criterionId));
  const criteria: ObservationPortCriterion[] = [];
  for (const criterion of definition.criteria) {
    if (criterion.visibility !== "public" || existing.has(criterion.id)) continue;
    const requested = requestedCriterion(criterion);
    if (requested) criteria.push(Object.freeze(requested));
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

  const acquired = await acquire(port, request, signal);
  if (signal?.aborted) return acquisitionFailure("OBSERVATION_CANCELLED");
  if (!acquired.ok) return acquired;
  const checkedReport = parseObservationPortReport(acquired.report);
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

  const origin = Object.freeze({
    ...(report.artifactDigest === undefined
      ? { kind: "independent" as const }
      : { kind: "artifact" as const, artifactDigest: report.artifactDigest }),
    sourceRef: report.provenance.adapterId,
    runRef: report.provenance.runRef,
    provenance: report.provenance,
    ...(report.termination === undefined ? {} : { termination: report.termination }),
  });
  const allowed = new Set(criteria.map((criterion) => criterion.criterionId));
  const returned = [];
  for (const [index, observation] of report.observations.entries()) {
    const path = `$.observations[${index}]`;
    if (!allowed.has(observation.criterionId)) return invalidEvidence(`${path}.criterionId`, "UNKNOWN_CRITERION");
    if (observation.kind === "execution" && report.provenance.runRef !== observation.runRef) {
      return invalidEvidence(`${path}.runRef`, "MISMATCHED_OBSERVATION");
    }
    // The shared evidence coverage boundary checks kind, selector, unit,
    // set item type and assertion IDs against the verified definition.
    const truncated = captureTruncated(
      observation.executionFact,
      report.provenance.stdoutTruncated,
      report.provenance.stderrTruncated,
    );
    // Incomplete captured output cannot be promoted to complete evidence.
    returned.push(
      Object.freeze({
        ...observation,
        origin,
        completeness: truncated ? "truncated" : observation.completeness,
      }),
    );
  }

  if (signal?.aborted) return acquisitionFailure("OBSERVATION_CANCELLED");
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
    ...(report.termination === undefined ? {} : { termination: report.termination }),
    ...(report.artifactDigest ? { artifactDigest: report.artifactDigest } : {}),
    provenance: report.provenance,
  });
  return Object.freeze({
    ok: true,
    evidence: parsedCombined.value,
    receipt,
  });
}
