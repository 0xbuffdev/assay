import type { JsonValue } from "../../contracts/common";
import type { Criterion } from "../../contracts/definition";
import type { Observation } from "../../contracts/evidence";
import { type Comparison, FAILED, finding, PASSED, REFERENCE_UNAVAILABLE } from "./finding";

/** Both inputs have already passed the same bounded inert-data snapshot. */
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equal(item, right[index]))
    );
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}

export function compareBoolean(
  criterion: Extract<Criterion, { kind: "boolean_equality" }>,
  observation: Observation,
  referenceValue?: boolean,
): Comparison {
  if (observation.kind !== "boolean")
    return finding({ outcome: "error", reasonCode: "COMPARATOR_ERROR" });
  const expected = criterion.parameters.expected;
  const value = expected.type === "literal" ? expected.value : referenceValue;
  if (value === undefined) return REFERENCE_UNAVAILABLE;
  return observation.value === value ? PASSED : FAILED;
}

export function compareJson(
  criterion: Extract<Criterion, { kind: "json_equality" }>,
  observation: Observation,
  referenceValue?: JsonValue,
): Comparison {
  if (observation.kind !== "json")
    return finding({ outcome: "error", reasonCode: "COMPARATOR_ERROR" });
  const expected = criterion.parameters.expected;
  const value = expected.type === "literal" ? expected.value : referenceValue;
  if (value === undefined) return REFERENCE_UNAVAILABLE;
  return equal(observation.value, value) ? PASSED : FAILED;
}
