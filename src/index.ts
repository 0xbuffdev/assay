/**
 * Assay standalone technical comparison and optional observation API (AY-I01–I03).
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
  ObservationCollectionResult,
  ObservationPort,
  ObservationPortCriterion,
  ObservationPortKind,
  ObservationPortProvenance,
  ObservationPortReceipt,
  ObservationPortReport,
  ObservationPortRequest,
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
export { collectObservations } from "./observation";
export {
  inspectEvidenceCoverage,
  parseAssessmentDefinition,
  parseEvaluationResult,
  parseEvidenceBundle,
  parseObservationPortReport,
} from "./validation";
