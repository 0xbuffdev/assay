import { equalJsonValue, type JsonValue } from "../../contracts/common";
import type { Criterion } from "../../contracts/definition";
import type { Observation } from "../../contracts/evidence";
import { type Comparison, FAILED, finding, PASSED, REFERENCE_UNAVAILABLE } from "./finding";

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
  return equalJsonValue(observation.value, value) ? PASSED : FAILED;
}
