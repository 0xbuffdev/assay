import type { ASSAY_SCHEMA_VERSION, SetItemType, SetScalar } from "./common";

export type CriterionMode = "required" | "advisory";
export type ReferenceVisibility = "public" | "restricted";

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

/** Authored definition before deterministic content hashing. */
export type AssessmentDefinitionDraft = Omit<AssessmentDefinition, "revisionDigest">;

export interface AssessmentDefinition {
  readonly schemaVersion: typeof ASSAY_SCHEMA_VERSION;
  readonly assessmentId: string;
  readonly revision: string;
  /** A SHA-256 claim. A host must authenticate and verify it independently. */
  readonly revisionDigest: string;
  readonly policyVersion: string;
  readonly criteria: readonly Criterion[];
}

export type DefinitionReference = Readonly<{
  assessmentId: string;
  revision: string;
  revisionDigest: string;
}>;
