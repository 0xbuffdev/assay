import type {
  Completeness,
  ExecutionFactFor,
  ExecutionTermination,
  JsonValue,
  SetItemType,
  SetScalar,
} from "./common";
import type { DefinitionReference } from "./definition";

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
  runRef?: string;
  termination?: ExecutionTermination;
  provenance?: ObservationPortProvenance;
}>;

/** A scoped origin claim; independent observations cannot be relabeled as artifact facts. */
export type ObservationOrigin = OriginSource &
  (
    | Readonly<{ kind: "independent"; artifactDigest?: never }>
    | Readonly<{ kind: "artifact"; artifactDigest: string }>
  );

type ExecutionValueKind = "text" | "number" | "boolean" | "json";

type ExecutionObservation = {
  [K in ExecutionValueKind]: Extract<ObservationFact, { kind: K }> &
    Readonly<{
      executionFact: ExecutionFactFor<K>;
      origin: ObservationOrigin & Readonly<{ runRef: string; termination: ExecutionTermination }>;
    }>;
}[ExecutionValueKind];

export type Observation =
  | (ObservationFact & Readonly<{ executionFact?: never; origin?: ObservationOrigin }>)
  | ExecutionObservation;

export interface EvidenceBundleDraft {
  readonly schemaVersion: 2;
  readonly artifactDigest?: string;
  readonly observations: readonly Observation[];
}

export interface EvidenceBundle extends EvidenceBundleDraft {
  readonly definition: DefinitionReference;
  readonly evidenceDigest: string;
}
