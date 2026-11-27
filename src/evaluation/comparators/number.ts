import type { NumericRange } from "../../contracts/common";
import type { Criterion } from "../../contracts/definition";
import type { Observation } from "../../contracts/evidence";
import { type Comparison, FAILED, finding, PASSED, REFERENCE_UNAVAILABLE } from "./finding";

/** Shared IEEE-754 relative bound used by comparison and result coherence. */
export function relativeToleranceBound(expected: number, relative: number): number {
  return relative * Math.abs(expected);
}

export function compareNumber(
  criterion: Extract<Criterion, { kind: "number_with_tolerance" }>,
  observation: Observation,
  referenceValue?: number,
): Comparison {
  if (observation.kind !== "number")
    return finding({ outcome: "error", reasonCode: "COMPARATOR_ERROR" });
  const { expected, tolerance } = criterion.parameters;
  const value = expected.type === "literal" ? expected.value : referenceValue;
  if (value === undefined) return REFERENCE_UNAVAILABLE;

  // Keep arithmetic overflows distinct from both a match and a wrong answer.
  const relativeBound = relativeToleranceBound(value, tolerance.relative);
  if (!Number.isFinite(relativeBound))
    return finding({ outcome: "error", reasonCode: "NUMERIC_OVERFLOW" });
  const bound = Math.max(tolerance.absolute, relativeBound);
  const difference = Math.abs(observation.value - value);
  if (!Number.isFinite(difference)) return FAILED;
  return difference <= bound ? PASSED : FAILED;
}

export function compareRange(
  criterion: Extract<Criterion, { kind: "number_range" }>,
  observation: Observation,
  referenceValue?: NumericRange,
): Comparison {
  if (observation.kind !== "number")
    return finding({ outcome: "error", reasonCode: "COMPARATOR_ERROR" });
  const expected = criterion.parameters.expected;
  const range = expected.type === "literal" ? expected.value : referenceValue;
  if (range === undefined) return REFERENCE_UNAVAILABLE;
  const value = observation.value;
  const lower = range.minInclusive ? value >= range.min : value > range.min;
  const upper = range.maxInclusive ? value <= range.max : value < range.max;
  return lower && upper ? PASSED : FAILED;
}
