import type { Criterion } from "../contracts/definition";
import type { Observation } from "../contracts/evidence";
import type { ReferenceRecord } from "../contracts/reference";
import type { Comparison } from "./comparators/finding";
import { compareNumber } from "./comparators/number";
import { compareExecution, compareManual } from "./comparators/review";
import { compareSet } from "./comparators/set";
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
  }
}
