/**
 * Assay standalone evaluation, content-integrity and learner-safe projection API.
 *
 * This module does not execute code, authenticate submitted values, award grades,
 * authenticate evidence, or contact any external service.
 */

export type {
  Completeness,
  ExecutionFact,
  ExecutionTermination,
  JsonValue,
  NumericRange,
  SetItemType,
  SetScalar,
} from "./contracts/common";
export { ASSAY_SCHEMA_VERSION, CONTRACT_LIMITS } from "./contracts/common";
export type {
  AssessmentDefinition,
  AssessmentDefinitionDraft,
  Criterion,
  CriterionBase,
  CriterionMode,
  DefinitionReference,
  DefinitionSchemaVersion,
  Expected,
  PolicyVersion,
  ReferenceVisibility,
  TextNormalization,
} from "./contracts/definition";
export type {
  EvidenceBundle,
  EvidenceBundleDraft,
  Observation,
  ObservationBase,
  ObservationFact,
  ObservationOrigin,
  ObservationPortProvenance,
} from "./contracts/evidence";
export type {
  ObservationAbortSignal,
  ObservationCollectionOptions,
  ObservationCollectionResult,
  ObservationPort,
  ObservationPortCriterion,
  ObservationPortKind,
  ObservationPortReceipt,
  ObservationPortReport,
  ObservationPortRequest,
} from "./contracts/observation";
export type {
  PublicCriterionFinding,
  PublicProjectionResponse,
  PublicReason,
  PublicTechnicalOutcome,
  PublicTechnicalResult,
} from "./contracts/projection";
export type { ReferenceBundle, ReferenceRecord, ReferenceRecordDraft } from "./contracts/reference";
export type {
  CriterionFinding,
  EvaluationFailure,
  EvaluationResponse,
  EvaluationResult,
  FindingOutcome,
  ReasonCode,
  TechnicalOutcome,
  WarningCode,
} from "./contracts/result";
export { ASSAY_EVALUATOR_VERSION } from "./contracts/result";
export type {
  DiagnosticCode,
  EvidenceCoverage,
  ValidationDiagnostic,
  ValidationDomain,
  ValidationResult,
} from "./contracts/validation";
export { evaluate } from "./evaluation/evaluate";
export {
  ASSAY_DEFINITION_DIGEST_VERSION,
  computeDefinitionDigest,
  createAssessmentDefinition,
  verifyAssessmentDefinition,
} from "./integrity/definition";
export { createEvidenceBundle, verifyEvidenceBundle } from "./integrity/evidence";
export { createReferenceRecord, verifyReferenceBundle } from "./integrity/reference";
export { collectObservations } from "./observation/collect";
export { projectPublicResult } from "./projection/public";
export { inspectEvidenceCoverage } from "./validation/coverage";
export { parseAssessmentDefinition, parseAssessmentDefinitionDraft } from "./validation/definition";
export { parseEvidenceBundle } from "./validation/evidence";
export { parseObservationPortReport } from "./validation/observation";
export { parseEvaluationResult } from "./validation/result";
