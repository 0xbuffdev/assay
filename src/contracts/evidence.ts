import type {
  Completeness,
  ExecutionFactFor,
  ExecutionTermination,
  JsonValue,
  SetItemType,
  SetScalar,
} from "./common";
import type { DefinitionReference } from "./definition";
import type { SCHEMA_VERSION } from "./version";

export type ObservationBase = Readonly<{
  criterionId: string;
  evidenceRef: string;
  completeness: Completeness;
}>;

export type ObservationFact =
  | (ObservationBase & Readonly<{ kind: "text"; value: string }>)
  | (ObservationBase & Readonly<{ kind: "boolean"; value: boolean }>)
  | (ObservationBase & Readonly<{ kind: "json"; value: JsonValue }>)
  | (ObservationBase &
      Readonly<{
        kind: "number";
        value: number;
        /** Required exactly when the matching numeric criterion declares a unit. */
        unit?: string;
      }>)
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

/** Bounded provider claims, not authenticated provenance. */
export interface ObservationPortProvenance {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly runRef: string;
  readonly toolchainId: string;
  readonly toolchainVersion: string;
  readonly capturedStdoutBytes: number;
  readonly capturedStderrBytes: number;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

type OriginSource = Readonly<{
  sourceRef: string;
  provenance?: ObservationPortProvenance;
}> &
  (
    | Readonly<{ runRef?: string; termination?: never }>
    | Readonly<{ runRef: string; termination: ExecutionTermination }>
  );

/** A scoped origin claim; independent observations cannot be relabeled as artifact facts. */
export type ObservationOrigin = OriginSource &
  (
    | Readonly<{ kind: "independent"; artifactDigest?: never }>
    | Readonly<{ kind: "artifact"; artifactDigest: string }>
  );

type ExecutionValueKind = "text" | "number" | "boolean" | "json";

type ExecutionObservation = {
  [K in ExecutionValueKind]: Extract<ObservationFact, { kind: K }> &
    (K extends "number" ? Readonly<{ unit?: never }> : unknown) &
    Readonly<{
      executionFact: ExecutionFactFor<K>;
      origin: ObservationOrigin & Readonly<{ runRef: string; termination: ExecutionTermination }>;
    }>;
}[ExecutionValueKind];

/** Host-supplied reviewer claims are not authenticated decision authority. */
export type QualitativeReviewer =
  | Readonly<{ kind: "human"; reviewerId: string; reviewerVersion: string }>
  | Readonly<{
      kind: "model";
      providerId: string;
      modelId: string;
      modelVersion: string;
      promptId: string;
      promptVersion: string;
    }>;

export type ReviewCitation = Readonly<{
  artifactRef: string;
  startByte: number;
  endByte: number;
}>;

export type QualitativeObservation = ObservationBase &
  Readonly<{
    kind: "qualitative_review";
    executionFact?: never;
    origin: Readonly<{
      kind: "artifact";
      artifactDigest: string;
      sourceRef: string;
      runRef?: never;
      termination?: never;
      provenance?: never;
    }>;
    reviewPolicyId: string;
    reviewPolicyVersion: string;
    reviewer: QualitativeReviewer;
    uncertainty: "low" | "medium" | "high" | "unknown";
    feedback: string;
    citations: readonly ReviewCitation[];
  }>;

export type Observation =
  | (ObservationFact & Readonly<{ executionFact?: never; origin?: ObservationOrigin }>)
  | ExecutionObservation
  | QualitativeObservation;

export interface EvidenceBundleDraft {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly artifactDigest?: string;
  readonly observations: readonly Observation[];
}

export interface EvidenceBundle extends EvidenceBundleDraft {
  readonly definition: DefinitionReference;
  readonly evidenceDigest: string;
}
