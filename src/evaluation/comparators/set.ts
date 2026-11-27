import type { SetScalar } from "../../contracts/common";
import type { Criterion } from "../../contracts/definition";
import type { Observation } from "../../contracts/evidence";
import { type Comparison, FAILED, finding, PASSED, REFERENCE_UNAVAILABLE } from "./finding";

function identical(a: SetScalar, b: SetScalar): boolean {
  // NaN and Infinity cannot reach this point through contract validation.
  // SameValueZero, including +0/-0 equivalence, matches Map/Set semantics.
  return a === b;
}

function matchesSet(
  observed: readonly SetScalar[],
  expected: readonly SetScalar[],
  order: "ignore" | "preserve",
  duplicates: "ignore" | "respect",
): boolean {
  if (order === "preserve") {
    const left = duplicates === "ignore" ? [...new Set(observed)] : observed;
    const right = duplicates === "ignore" ? [...new Set(expected)] : expected;
    return (
      left.length === right.length && left.every((item, index) => identical(item, right[index]))
    );
  }

  if (duplicates === "ignore") {
    const left = new Set(observed);
    const right = new Set(expected);
    return left.size === right.size && [...left].every((item) => right.has(item));
  }

  if (observed.length !== expected.length) return false;
  const counts = new Map<SetScalar, number>();
  for (const item of expected) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of observed) {
    const remaining = counts.get(item);
    if (remaining === undefined || remaining === 0) return false;
    counts.set(item, remaining - 1);
  }
  return true;
}

export function compareSet(
  criterion: Extract<Criterion, { kind: "set_equivalence" }>,
  observation: Observation,
): Comparison {
  if (observation.kind !== "set") return finding("error", "COMPARATOR_ERROR");
  const { expected, order, duplicates } = criterion.parameters;
  if (expected.type === "reference") return REFERENCE_UNAVAILABLE;
  return matchesSet(observation.items, expected.value, order, duplicates) ? PASSED : FAILED;
}
