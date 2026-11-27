import type { AssessmentDefinition } from "../contracts/definition";
import type { FindingOutcome, TechnicalOutcome, WarningCode } from "../contracts/result";

export function aggregateRequired(
  definition: AssessmentDefinition,
  comparisons: ReadonlyMap<string, Readonly<{ outcome: FindingOutcome }>>,
): TechnicalOutcome {
  // Validated definitions always have the supported policy and a required criterion.
  if (definition.policyVersion !== "all-required-v1") return "evaluation_error";
  const mandatory = definition.criteria
    .filter((criterion) => criterion.mode === "required")
    .map((criterion) => comparisons.get(criterion.id)?.outcome);
  // Conjunction: one definite required failure is conclusive even if other
  // required observations are missing. Advisory outcomes cannot compensate.
  if (mandatory.length === 0) return "evaluation_error";
  if (mandatory.includes("fail")) return "fail";
  if (mandatory.includes("error")) return "evaluation_error";
  if (mandatory.some((outcome) => outcome !== "pass")) return "inconclusive";
  return "pass";
}

/** Advisory uncertainty is reported separately and never changes the required verdict. */
export function advisoryWarnings(
  definition: AssessmentDefinition,
  comparisons: ReadonlyMap<string, Readonly<{ outcome: FindingOutcome }>>,
): readonly WarningCode[] {
  return Object.freeze(
    definition.criteria.some((criterion) => {
      if (criterion.mode !== "advisory") return false;
      const outcome = comparisons.get(criterion.id)?.outcome;
      return outcome === "inconclusive" || outcome === "error";
    })
      ? ["ADVISORY_UNRESOLVED" as const]
      : [],
  );
}
