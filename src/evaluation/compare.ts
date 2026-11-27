import type { Criterion } from "../contracts/definition";
import type { Observation } from "../contracts/evidence";
import type { Comparison } from "./comparators/finding";
import { compareNumber } from "./comparators/number";
import { compareExecution, compareManual } from "./comparators/review";
import { compareSet } from "./comparators/set";
import { compareExactText, compareNormalizedText } from "./comparators/text";

/**
 * Evaluate one structurally validated criterion and observation.
 * Reference IDs are never resolved from submitted evidence, and execution
 * claims are never accepted as authenticated proof by this milestone.
 */
export function compare(criterion: Criterion, observation: Observation): Comparison {
  switch (criterion.kind) {
    case "exact_text":
      return compareExactText(criterion, observation);
    case "normalized_text":
      return compareNormalizedText(criterion, observation);
    case "number_with_tolerance":
      return compareNumber(criterion, observation);
    case "set_equivalence":
      return compareSet(criterion, observation);
    case "observed_execution":
      return compareExecution(criterion, observation);
    case "manual_evidence":
      return compareManual(criterion, observation);
  }
}
