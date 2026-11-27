/**
 * Assay standalone evaluation, content-integrity and learner-safe projection API.
 *
 * This module does not execute code, authenticate submitted values, award grades,
 * authenticate evidence, or contact any external service.
 */

export type { Completeness, SetItemType, SetScalar } from "./contracts/common";
export { ASSAY_SCHEMA_VERSION, CONTRACT_LIMITS } from "./contracts/common";
export type {
  AssessmentDefinition,
  AssessmentDefinitionDraft,
  Criterion,
  CriterionBase,
  CriterionMode,
  DefinitionReference,
  Expected,
  ReferenceVisibility,
  TextNormalization,
} from "./contracts/definition";
export type { EvidenceBundle, Observation, ObservationBase } from "./contracts/evidence";
export type {
  ObservationCollectionResult,
  ObservationPort,
  ObservationPortCriterion,
  ObservationPortKind,
  ObservationPortProvenance,
  ObservationPortReceipt,
  ObservationPortReport,
  ObservationPortRequest,
} from "./contracts/observation";
export type {
  PublicCriterionFinding,
  PublicProjectionResponse,
  PublicTechnicalOutcome,
  PublicTechnicalResult,
} from "./contracts/projection";
export type {
  CriterionFinding,
  EvaluationFailure,
  EvaluationResponse,
  EvaluationResult,
  FindingOutcome,
  TechnicalOutcome,
} from "./contracts/result";
export type {
  DiagnosticCode,
  EvidenceCoverage,
  ValidationDiagnostic,
  ValidationDomain,
  ValidationResult,
} from "./contracts/validation";
export { ASSAY_EVALUATOR_VERSION, evaluate } from "./evaluation/evaluate";
export {
  ASSAY_DEFINITION_DIGEST_VERSION,
  computeDefinitionDigest,
  createAssessmentDefinition,
  verifyAssessmentDefinition,
} from "./integrity/definition";
export { collectObservations } from "./observation/collect";
export { projectPublicResult } from "./projection/public";
export { inspectEvidenceCoverage } from "./validation/coverage";
export { parseAssessmentDefinition, parseAssessmentDefinitionDraft } from "./validation/definition";
export { parseEvidenceBundle } from "./validation/evidence";
export { parseObservationPortReport } from "./validation/observation";
export { parseEvaluationResult } from "./validation/result";
