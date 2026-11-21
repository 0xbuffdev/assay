/**
 * Assay contract and validation API (AY-I01).
 *
 * This module does not execute code, compare submitted values, award grades,
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
export {
  inspectEvidenceCoverage,
  parseAssessmentDefinition,
  parseEvaluationResult,
  parseEvidenceBundle,
} from "./validation";
