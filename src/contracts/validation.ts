export type ValidationDomain =
  | "invalid_definition"
  | "invalid_evidence"
  | "invalid_reference"
  | "invalid_result";
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
  | "DEFINITION_DIGEST_MISMATCH"
  | "REFERENCE_DIGEST_MISMATCH"
  | "UNKNOWN_REFERENCE"
  | "MISMATCHED_REFERENCE"
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
