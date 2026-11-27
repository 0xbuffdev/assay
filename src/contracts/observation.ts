import type { SCHEMA_VERSION } from "./version";
import type { ExecutionFactFor, ExecutionTermination, SetItemType } from "./common";
import type { DefinitionReference } from "./definition";
import type { EvidenceBundle, ObservationFact, ObservationPortProvenance } from "./evidence";
import type { ValidationDiagnostic } from "./validation";

/**
 * The requested facts contain no reference answers, hidden test definitions,
 * grader source, executable commands or untrusted callbacks.
 */
export type ObservationPortKind = "text" | "number" | "set" | "execution" | "boolean" | "json";
type SelectedKind = "text" | "number" | "boolean" | "json";

type SelectedRequest = {
  [K in SelectedKind]: Readonly<{
    kind: K;
    executionFact: ExecutionFactFor<K>;
    unit?: never;
  }>;
}[SelectedKind];

export type ObservationPortCriterion = Readonly<{ criterionId: string }> &
  (
    | Readonly<{ kind: "text" | "boolean" | "json"; executionFact?: never }>
    | Readonly<{ kind: "number"; unit?: string; executionFact?: never }>
    | Readonly<{ kind: "set"; itemType: SetItemType }>
    | Readonly<{ kind: "execution"; assertionIds: readonly string[] }>
    | SelectedRequest
  );

type SelectedReportFact = {
  [K in SelectedKind]: Extract<ObservationFact, { kind: K }> &
    (K extends "number" ? Readonly<{ unit?: never }> : unknown) &
    Readonly<{ executionFact: ExecutionFactFor<K>; origin?: never }>;
}[SelectedKind];

type UnselectedReportFact = Exclude<ObservationFact, { kind: "manual" }> &
  Readonly<{ executionFact?: never; origin?: never }>;

type ReportFact = UnselectedReportFact | SelectedReportFact;

/** Structural cancellation surface, compatible with native AbortSignal.
 * No ambient DOM or Node declarations are required by the installed package.
 * Structural hosts must set aborted before notifying all registered abort
 * listeners and must not suppress notification. Listener methods must not throw.
 */
export interface ObservationAbortSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface ObservationCollectionOptions<
  S extends ObservationAbortSignal = ObservationAbortSignal,
> {
  readonly signal?: S;
}

export interface ObservationPortRequest {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly definition: DefinitionReference;
  readonly artifactDigest?: string;
  readonly criteria: readonly ObservationPortCriterion[];
  readonly limits: Readonly<{ maxCapturedBytes: number }>;
}

/**
 * Optional observation acquisition. An injected implementation may use a real
 * runner, test fixture or no execution at all. Calling this port does NOT
 * establish its authenticity or confer credential/grade authority.
 */
export interface ObservationPort<S extends ObservationAbortSignal = ObservationAbortSignal> {
  observe(request: ObservationPortRequest, signal?: S): Promise<unknown>;
}

export type ObservationPortReport = Readonly<{
  schemaVersion: typeof SCHEMA_VERSION;
  definition: DefinitionReference;
  artifactDigest?: string;
  provenance: ObservationPortProvenance;
}> &
  (
    | Readonly<{
        termination?: ExecutionTermination;
        observations: readonly UnselectedReportFact[];
      }>
    | Readonly<{
        termination: ExecutionTermination;
        observations: readonly ReportFact[];
      }>
  );

export interface ObservationPortReceipt {
  readonly definition: DefinitionReference;
  readonly evidenceDigest: string;
  readonly evidenceRefs: readonly string[];
  readonly termination?: ExecutionTermination;
  readonly artifactDigest?: string;
  readonly provenance: ObservationPortProvenance;
}

export type ObservationCollectionResult =
  | Readonly<{
      ok: true;
      evidence: EvidenceBundle;
      receipt: ObservationPortReceipt | null;
    }>
  | Readonly<{
      ok: false;
      outcome: "invalid_definition" | "invalid_evidence";
      diagnostics: readonly ValidationDiagnostic[];
    }>
  | Readonly<{
      ok: false;
      outcome: "evaluation_error";
      reasonCode: "OBSERVATION_PORT_ERROR" | "OBSERVATION_CANCELLED";
    }>;
