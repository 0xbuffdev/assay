import type { SetItemType, SetScalar } from "./common";

export type DefinitionSchemaVersion = 1 | 2;

export type CriterionMode = "required" | "advisory";
export type ReferenceVisibility = "public" | "restricted";

export type Expected<T, V extends DefinitionSchemaVersion = DefinitionSchemaVersion> =
  | Readonly<{ type: "literal"; value: T }>
  | (V extends 1
      ? Readonly<{ type: "reference"; referenceId: string }>
      : Readonly<{ type: "reference"; referenceId: string; referenceDigest: string }>);

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

export type Criterion<V extends DefinitionSchemaVersion = DefinitionSchemaVersion> =
  | (CriterionBase &
      Readonly<{
        kind: "exact_text";
        parameters: Readonly<{ expected: Expected<string, V> }>;
      }>)
  | (CriterionBase &
      Readonly<{
        kind: "normalized_text";
        parameters: Readonly<{ expected: Expected<string, V>; normalization: TextNormalization }>;
      }>)
  | (CriterionBase &
      Readonly<{
        kind: "number_with_tolerance";
        parameters: Readonly<{
          expected: Expected<number, V>;
          tolerance: Readonly<{ absolute: number; relative: number }>;
          unit?: string;
        }>;
      }>)
  | (CriterionBase &
      Readonly<{
        kind: "set_equivalence";
        parameters: Readonly<{
          expected: Expected<readonly SetScalar[], V>;
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
export type AssessmentDefinitionDraft<V extends DefinitionSchemaVersion = DefinitionSchemaVersion> =
  V extends DefinitionSchemaVersion ? Omit<DefinitionFields<V>, "revisionDigest"> : never;

export type AssessmentDefinition<V extends DefinitionSchemaVersion = DefinitionSchemaVersion> =
  V extends DefinitionSchemaVersion ? DefinitionFields<V> : never;

interface DefinitionFields<V extends DefinitionSchemaVersion> {
  readonly schemaVersion: V;
  readonly assessmentId: string;
  readonly revision: string;
  /** A SHA-256 claim. A host must authenticate and verify it independently. */
  readonly revisionDigest: string;
  readonly policyVersion: string;
  readonly criteria: readonly Criterion<V>[];
}

export type DefinitionReference = Readonly<{
  assessmentId: string;
  revision: string;
  revisionDigest: string;
}>;
