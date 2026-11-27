import type { ASSAY_SCHEMA_VERSION } from "./common";
import type { FindingOutcome } from "./result";

/**
 * A deliberately minimal learner-facing view. Public per-criterion outcomes
 * never carry evidence refs, expected values, evaluator messages or reasons.
 *
 * "withheld" means no overall technical verdict is published when the
 * underlying definition contains any restricted criterion, even an advisory.
 * It does not report a hidden pass, failure, count, or review authority.
 */
export type PublicTechnicalOutcome =
  | "pass"
  | "fail"
  | "inconclusive"
  | "evaluation_error"
  | "withheld";

export interface PublicCriterionFinding {
  readonly criterionId: string;
  readonly outcome: FindingOutcome;
}

export interface PublicTechnicalResult {
  readonly schemaVersion: typeof ASSAY_SCHEMA_VERSION;
  readonly outcome: PublicTechnicalOutcome;
  readonly findings: readonly PublicCriterionFinding[];
}

/**
 * All invalid definition/result inputs return an identical opaque failure.
 * Never echo paths, diagnostic codes or raw inputs at a public boundary.
 */
export type PublicProjectionResponse =
  | Readonly<{ ok: true; value: PublicTechnicalResult }>
  | Readonly<{ ok: false; reasonCode: "PUBLIC_PROJECTION_REJECTED" }>;
