/**
 * Versioned, portable data contracts for Assay.
 *
 * Types describe technical evidence, not authentication, academic authority
 * or execution isolation. Immutable references are caller claims until a host
 * independently verifies their provenance.
 */
export const ASSAY_SCHEMA_VERSION = 1 as const;

export const CONTRACT_LIMITS = Object.freeze({
  maxDepth: 12,
  maxNodes: 4096,
  maxInputBytes: 262_144,
  maxStringLength: 16_384,
  maxIdentifierLength: 96,
  maxObjectKeys: 32,
  maxArrayLength: 128,
  maxCriteria: 64,
  maxObservations: 128,
  maxSetItems: 128,
  maxEvidenceRefs: 32,
  maxDiagnostics: 32,
} as const);

export type TechnicalOutcome =
  | "pass"
  | "fail"
  | "inconclusive"
  | "invalid_definition"
  | "invalid_evidence"
  | "evaluation_error";

export type FindingOutcome = "pass" | "fail" | "inconclusive" | "error";
export type CriterionMode = "required" | "advisory";
export type ReferenceVisibility = "public" | "restricted";
export type Completeness = "complete" | "truncated";

export type Expected<T> =
  | Readonly<{ type: "literal"; value: T }>
  | Readonly<{ type: "reference"; referenceId: string }>;

export interface CriterionBase {
  readonly id: string;
  readonly mode: CriterionMode;
  readonly visibility: ReferenceVisibility;
}

export type TextNormalization = Readonly<{
  lineEndings: "preserve" | "lf";
  unicode: "none" | "NFC" | "NFKC";
  case: "sensitive" | "fold";
  whitespace: "preserve" | "collapse";
  trim: "none" | "both";
}>;

export type SetItemType = "string" | "number" | "boolean";
export type SetScalar = string | number | boolean;

export type Criterion =
  | (CriterionBase &
      Readonly<{
        kind: "exact_text";
        parameters: Readonly<{ expected: Expected<string> }>;
      }>)
  | (CriterionBase &
      Readonly<{
        kind: "normalized_text";
        parameters: Readonly<{ expected: Expected<string>; normalization: TextNormalization }>;
      }>)
  | (CriterionBase &
      Readonly<{
        kind: "number_with_tolerance";
        parameters: Readonly<{
          expected: Expected<number>;
          tolerance: Readonly<{ absolute: number; relative: number }>;
          unit?: string;
        }>;
      }>)
  | (CriterionBase &
      Readonly<{
        kind: "set_equivalence";
        parameters: Readonly<{
          expected: Expected<readonly SetScalar[]>;
          itemType: SetItemType;
          order: "ignore" | "preserve";
          duplicates: "ignore" | "respect";
        }>;
      }>)
  | (CriterionBase &
      Readonly<{
        kind: "observed_execution";
        parameters: Readonly<{
          assertions: readonly Readonly<{ id: string; referenceId: string }>[];
        }>;
      }>)
  | (CriterionBase &
      Readonly<{
        kind: "manual_evidence";
        parameters: Readonly<{ review: "required" }>;
      }>);

export interface AssessmentDefinition {
  readonly schemaVersion: typeof ASSAY_SCHEMA_VERSION;
  readonly assessmentId: string;
  readonly revision: string;
  /** A SHA-256 claim. A host must authenticate and verify it independently. */
  readonly revisionDigest: string;
  readonly policyVersion: string;
  readonly criteria: readonly Criterion[];
}

export type ObservationBase = Readonly<{
  criterionId: string;
  evidenceRef: string;
  completeness: Completeness;
}>;

export type Observation =
  | (ObservationBase & Readonly<{ kind: "text"; value: string }>)
  | (ObservationBase & Readonly<{ kind: "number"; value: number }>)
  | (ObservationBase &
      Readonly<{
        kind: "set";
        itemType: SetItemType;
        items: readonly SetScalar[];
      }>)
  | (ObservationBase &
      Readonly<{
        kind: "execution";
        runRef: string;
        assertions: readonly Readonly<{
          assertionId: string;
          state: "confirmed" | "refuted" | "unknown";
        }>[];
      }>)
  | (ObservationBase &
      Readonly<{
        kind: "manual";
        artifactRefs: readonly string[];
      }>);

export type DefinitionReference = Readonly<{
  assessmentId: string;
  revision: string;
  revisionDigest: string;
}>;

export interface EvidenceBundle {
  readonly schemaVersion: typeof ASSAY_SCHEMA_VERSION;
  readonly definition: DefinitionReference;
  readonly artifactDigest?: string;
  readonly observations: readonly Observation[];
}

/** Technical diagnostics and findings never echo submitted values or secret references. */
export interface CriterionFinding {
  readonly criterionId: string;
  readonly outcome: FindingOutcome;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
}

export interface EvaluationResult {
  readonly schemaVersion: typeof ASSAY_SCHEMA_VERSION;
  readonly outcome: TechnicalOutcome;
  readonly definition: DefinitionReference;
  readonly policyVersion: string;
  readonly findings: readonly CriterionFinding[];
  readonly evaluator: Readonly<{ id: string; version: string }>;
  readonly warnings: readonly string[];
}

export type ValidationDomain = "invalid_definition" | "invalid_evidence" | "invalid_result";
export type DiagnosticCode =
  | "UNSUPPORTED_INPUT"
  | "INPUT_TOO_DEEP"
  | "INPUT_TOO_LARGE"
  | "TOO_MANY_ITEMS"
  | "UNSAFE_OBJECT"
  | "UNSAFE_KEY"
  | "UNSAFE_NUMBER"
  | "UNEXPECTED_FIELD"
  | "MISSING_FIELD"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "UNSUPPORTED_VERSION"
  | "DUPLICATE_ID"
  | "EMPTY_REQUIRED_CRITERIA"
  | "RESTRICTED_LITERAL"
  | "MISMATCHED_DEFINITION"
  | "UNKNOWN_CRITERION"
  | "MISMATCHED_OBSERVATION"
  | "TOO_MANY_DIAGNOSTICS";

export interface ValidationDiagnostic {
  readonly path: string;
  readonly code: DiagnosticCode;
}

export type ValidationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      domain: ValidationDomain;
      diagnostics: readonly ValidationDiagnostic[];
    }>;

export type EvidenceCoverage = Readonly<{
  missingRequired: readonly string[];
  incompleteRequired: readonly string[];
}>;
