import type { Criterion } from "../contracts/definition";
import type { Observation } from "../contracts/evidence";
import type { ReferenceRecord } from "../contracts/reference";
import { type Comparison, finding } from "./comparators/finding";
import { compareNumber, compareRange } from "./comparators/number";
import { compareExecution, compareManual } from "./comparators/review";
import { compareSet } from "./comparators/set";
import { compareBoolean, compareJson } from "./comparators/structured";
import { compareExactText, compareNormalizedText } from "./comparators/text";

/**
 * Evaluate one structurally validated criterion and observation.
 * References come only from the verified bundle, never submitted evidence. Execution
 * claims are never accepted as authenticated proof by this milestone.
 */
export function compare(
  criterion: Criterion,
  observation: Observation,
  references: ReadonlyMap<string, ReferenceRecord>,
): Comparison {
  const expected = "expected" in criterion.parameters ? criterion.parameters.expected : undefined;
  const reference =
    expected?.type === "reference" ? references.get(expected.referenceId) : undefined;
  switch (criterion.kind) {
    case "exact_text":
      return compareExactText(
        criterion,
        observation,
        reference?.kind === "text" ? reference.value : undefined,
      );
    case "normalized_text":
      return compareNormalizedText(
        criterion,
        observation,
        reference?.kind === "text" ? reference.value : undefined,
      );
    case "number_with_tolerance":
      return compareNumber(
        criterion,
        observation,
        reference?.kind === "number" ? reference.value : undefined,
      );
    case "boolean_equality":
      return compareBoolean(
        criterion,
        observation,
        reference?.kind === "boolean" ? reference.value : undefined,
      );
    case "number_range":
      return compareRange(
        criterion,
        observation,
        reference?.kind === "range" ? reference.value : undefined,
      );
    case "json_equality":
      return compareJson(
        criterion,
        observation,
        reference?.kind === "json" ? reference.value : undefined,
      );
    case "set_equivalence":
      return compareSet(
        criterion,
        observation,
        reference?.kind === "set" ? reference.value : undefined,
      );
    case "observed_execution":
      return compareExecution(criterion, observation);
    case "manual_evidence":
      return compareManual(observation);
    case "qualitative_review":
      return finding({ outcome: "inconclusive", reasonCode: "REVIEW_REQUIRED" });
  }
}
