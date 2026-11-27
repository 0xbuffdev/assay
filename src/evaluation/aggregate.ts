import type { AssessmentDefinition } from "../contracts/definition";
import type { FindingOutcome, TechnicalOutcome, WarningCode } from "../contracts/result";

const ALL_PRECEDENCE: readonly TechnicalOutcome[] = [
  "fail",
  "evaluation_error",
  "inconclusive",
  "pass",
];
const ANY_PRECEDENCE: readonly TechnicalOutcome[] = [
  "pass",
  "evaluation_error",
  "inconclusive",
  "fail",
];

/** Aggregate only a validated, bounded composition; no evidence is skipped. */
export function aggregateRequired(
  definition: AssessmentDefinition,
  comparisons: ReadonlyMap<string, Readonly<{ outcome: FindingOutcome }>>,
): TechnicalOutcome {
  const groups = new Map(definition.composition.groups.map((group) => [group.id, group]));
  function visit(id: string): TechnicalOutcome {
    const group = groups.get(id);
    if (!group) return "evaluation_error";
    const order = group.operator === "all" ? ALL_PRECEDENCE : ANY_PRECEDENCE;
    const outcomes = group.children.map((child): TechnicalOutcome => {
      if (child.kind === "group") return visit(child.id);
      const outcome = comparisons.get(child.id)?.outcome;
      return outcome === "error" || outcome === undefined ? "evaluation_error" : outcome;
    });
    return order.find((outcome) => outcomes.includes(outcome)) ?? "evaluation_error";
  }
  return visit(definition.composition.rootGroupId);
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
