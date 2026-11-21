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
  EvaluationFailure,
  EvaluationResponse,
  EvaluationResult,
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
export {
  ASSAY_SCHEMA_VERSION,
  CONTRACT_LIMITS,
} from "./contracts";
export { ASSAY_EVALUATOR_VERSION, evaluate } from "./evaluate";
export {
  inspectEvidenceCoverage,
  parseAssessmentDefinition,
  parseEvaluationResult,
  parseEvidenceBundle,
} from "./validation";
