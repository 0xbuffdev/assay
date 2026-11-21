/**
 * Assay standalone deterministic technical comparison API (AY-I01–I02).
 *
 * This module does not execute code, authenticate submitted values, award grades,
 * authenticate evidence, or contact any external service.
 */

export type {
  AssessmentDefinition,
  Completeness,
  Criterion,
  CriterionBase,
  CriterionFinding,
  CriterionMode,
  DefinitionReference,
  DiagnosticCode,
  EvaluationResult,
  EvaluationFailure,
  EvaluationResponse,
  EvidenceBundle,
  EvidenceCoverage,
  Expected,
  FindingOutcome,
  Observation,
  ObservationBase,
  ReferenceVisibility,
  SetItemType,
  SetScalar,
  TechnicalOutcome,
  TextNormalization,
  ValidationDiagnostic,
  ValidationDomain,
  ValidationResult,
} from "./contracts";
export { ASSAY_EVALUATOR_VERSION, evaluate } from "./evaluate";
export {
  ASSAY_SCHEMA_VERSION,
  CONTRACT_LIMITS,
} from "./contracts";
export {
  inspectEvidenceCoverage,
  parseAssessmentDefinition,
  parseEvaluationResult,
  parseEvidenceBundle,
} from "./validation";
