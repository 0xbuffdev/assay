/**
 * Assay standalone evaluation, content-integrity and learner-safe projection API.
 *
 * This module does not execute code, authenticate submitted values, award grades,
 * authenticate evidence, or contact any external service.
 */

export type {
  AssessmentDefinition,
  AssessmentDefinitionDraft,
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
  ObservationCollectionResult,
  ObservationPort,
  ObservationPortCriterion,
  ObservationPortKind,
  ObservationPortProvenance,
  ObservationPortReceipt,
  ObservationPortReport,
  ObservationPortRequest,
  PublicCriterionFinding,
  PublicProjectionResponse,
  PublicTechnicalOutcome,
  PublicTechnicalResult,
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
  ASSAY_DEFINITION_DIGEST_VERSION,
  collectVerifiedObservations,
  computeDefinitionDigest,
  createAssessmentDefinition,
  evaluateVerified,
  verifyAssessmentDefinition,
} from "./integrity";
export { collectObservations } from "./observation";
export { projectPublicResult } from "./projection";
export {
  inspectEvidenceCoverage,
  parseAssessmentDefinition,
  parseAssessmentDefinitionDraft,
  parseEvaluationResult,
  parseEvidenceBundle,
  parseObservationPortReport,
} from "./validation";
