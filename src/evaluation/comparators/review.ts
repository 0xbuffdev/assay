import type { Criterion } from "../../contracts/definition";
import type { Observation } from "../../contracts/evidence";
import { type Comparison, finding } from "./finding";

export function compareExecution(
  criterion: Extract<Criterion, { kind: "observed_execution" }>,
  observation: Observation,
): Comparison {
  if (observation.kind !== "execution") return finding("error", "COMPARATOR_ERROR");
  // The observation records assertion states, not their authenticity.
  // AY-I03 can collect facts from an injected port, but a port report
  // is still a provenance claim, not independently authenticated proof.
  // Even all "confirmed" assertions cannot grant a technical pass.
  const incomplete = criterion.parameters.assertions.some(
    ({ id }) =>
      !observation.assertions.some(
        (assertion) => assertion.assertionId === id && assertion.state !== "unknown",
      ),
  );
  return finding("inconclusive", incomplete ? "ASSERTION_INCOMPLETE" : "EXECUTION_UNVERIFIED");
}

export function compareManual(
  criterion: Extract<Criterion, { kind: "manual_evidence" }>,
  observation: Observation,
): Comparison {
  if (observation.kind !== "manual") return finding("error", "COMPARATOR_ERROR");
  return finding(
    "inconclusive",
    observation.artifactRefs.length === 0 ? "ARTIFACT_MISSING" : "REVIEW_REQUIRED",
  );
}
