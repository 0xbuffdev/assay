import type { Criterion } from "../../contracts/definition";
import type { Observation } from "../../contracts/evidence";
import { type Comparison, FAILED, finding, PASSED, REFERENCE_UNAVAILABLE } from "./finding";

export function compareNumber(
  criterion: Extract<Criterion, { kind: "number_with_tolerance" }>,
  observation: Observation,
): Comparison {
  if (observation.kind !== "number") return finding("error", "COMPARATOR_ERROR");
  const { expected, tolerance } = criterion.parameters;
  if (expected.type === "reference") return REFERENCE_UNAVAILABLE;

  // Keep arithmetic overflows distinct from both a match and a wrong answer.
  const relativeBound = tolerance.relative * Math.abs(expected.value);
  if (!Number.isFinite(relativeBound)) return finding("error", "NUMERIC_OVERFLOW");
  const bound = Math.max(tolerance.absolute, relativeBound);
  const difference = Math.abs(observation.value - expected.value);
  if (!Number.isFinite(difference)) return FAILED;
  return difference <= bound ? PASSED : FAILED;
}
