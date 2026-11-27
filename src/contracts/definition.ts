import type { ExecutionFact, JsonValue, NumericRange, SetItemType, SetScalar } from "./common";
import type { SCHEMA_VERSION } from "./version";

/** The only supported binding aggregation policy. */
export type PolicyVersion = "composed-required-v1";

export type CriterionMode = "required" | "advisory";
export type ReferenceVisibility = "public" | "restricted";

export type Expected<T> =
  | Readonly<{ type: "literal"; value: T }>
  | Readonly<{ type: "reference"; referenceId: string; referenceDigest: string }>;

export type CompositionChild = Readonly<{
  kind: "criterion" | "group";
  id: string;
}>;

export interface CriterionGroup {
  readonly id: string;
  readonly operator: "all" | "any";
  readonly children: readonly CompositionChild[];
}

export interface CriterionComposition {
  readonly rootGroupId: string;
  readonly groups: readonly CriterionGroup[];
}

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

type ExecutionSelection<F extends ExecutionFact = never> = Readonly<{ executionFact?: F }>;

type NumericExecutionSelection<P> =
  | Readonly<{ executionFact?: never; parameters: Readonly<P & { unit?: string }> }>
  | Readonly<{
      executionFact: "exit_status";
      parameters: Readonly<P & { unit?: never }>;
    }>;

export type Criterion =
  | (CriterionBase &
      ExecutionSelection<"stdout" | "stderr"> &
      Readonly<{
        kind: "exact_text";
        parameters: Readonly<{ expected: Expected<string> }>;
      }>)
  | (CriterionBase &
      ExecutionSelection<"stdout" | "stderr"> &
      Readonly<{
        kind: "normalized_text";
        parameters: Readonly<{ expected: Expected<string>; normalization: TextNormalization }>;
      }>)
  | (CriterionBase &
      Readonly<{ kind: "number_with_tolerance" }> &
      NumericExecutionSelection<
        {
          expected: Expected<number>;
          tolerance: Readonly<{ absolute: number; relative: number }>;
        }
      >)
  | (CriterionBase &
      ExecutionSelection<never> &
      Readonly<{
        kind: "set_equivalence";
        parameters: Readonly<{
          expected: Expected<readonly SetScalar[]>;
          itemType: SetItemType;
          order: "ignore" | "preserve";
          duplicates: "ignore" | "respect";
        }>;
      }>)
  | AdditionalObjectiveCriterion
  | (CriterionBase &
      ExecutionSelection<never> &
      Readonly<{
        kind: "observed_execution";
        parameters: Readonly<{
          assertions: readonly Readonly<{ id: string; referenceId: string }>[];
        }>;
      }>)
  | (CriterionBase &
      ExecutionSelection<never> &
      Readonly<{
        kind: "manual_evidence";
        parameters: Readonly<{ review: "required" }>;
      }>);

/** Authored definition before deterministic content hashing. */
export type AssessmentDefinitionDraft = Omit<AssessmentDefinition, "revisionDigest">;

export interface AssessmentDefinition {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly assessmentId: string;
  readonly revision: string;
  /** A SHA-256 claim. A host must authenticate and verify it independently. */
  readonly revisionDigest: string;
  readonly policyVersion: PolicyVersion;
  readonly criteria: readonly Criterion[];
  readonly composition: CriterionComposition;
}

export type DefinitionReference = Readonly<{
  assessmentId: string;
  revision: string;
  revisionDigest: string;
}>;

type AdditionalObjectiveCriterion =
  | (CriterionBase &
      ExecutionSelection<"boolean_property"> &
      Readonly<{
        kind: "boolean_equality";
        parameters: Readonly<{ expected: Expected<boolean> }>;
      }>)
  | (CriterionBase &
      Readonly<{ kind: "number_range" }> &
      NumericExecutionSelection<{ expected: Expected<NumericRange> }>)
  | (CriterionBase &
      ExecutionSelection<"structured_stdout" | "structured_stderr"> &
      Readonly<{
        kind: "json_equality";
        parameters: Readonly<{ expected: Expected<JsonValue> }>;
      }>);
