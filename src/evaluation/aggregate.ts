import type { AssessmentDefinition } from "../contracts/definition";
import type { FindingOutcome, TechnicalOutcome } from "../contracts/result";

export function aggregateRequired(
  definition: AssessmentDefinition,
  comparisons: ReadonlyMap<string, Readonly<{ outcome: FindingOutcome }>>,
): Exclude<TechnicalOutcome, "invalid_definition" | "invalid_evidence"> {
  const mandatory = definition.criteria
    .filter((criterion) => criterion.mode === "required")
    .map((criterion) => comparisons.get(criterion.id)?.outcome);
  // Conjunction: one definite required failure is conclusive even if other
  // required observations are missing. Advisory outcomes cannot compensate.
  if (mandatory.includes("fail")) return "fail";
  if (mandatory.includes("error")) return "evaluation_error";
  if (mandatory.some((outcome) => outcome !== "pass")) return "inconclusive";
  return "pass";
}
