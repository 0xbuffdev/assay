import type { ASSAY_SCHEMA_VERSION } from "./common";
import type { DefinitionReference } from "./definition";
import type { EvidenceBundle, Observation } from "./evidence";
import type { ValidationDiagnostic } from "./validation";

/**
 * The requested facts contain no reference answers, hidden test definitions,
 * grader source, executable commands or untrusted callbacks.
 */
export type ObservationPortKind = "text" | "number" | "set" | "execution";
export type ObservationPortCriterion = Readonly<{
  criterionId: string;
  kind: ObservationPortKind;
  /** Public unit metadata for numeric observations, never an expected value. */
  unit?: string;
  assertionIds?: readonly string[];
}>;

export interface ObservationPortRequest {
  readonly schemaVersion: typeof ASSAY_SCHEMA_VERSION;
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
export interface ObservationPort {
  observe(request: ObservationPortRequest): Promise<unknown>;
}

/** Bounded claimed provenance, not a trust certificate or signed attestation. */
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

export interface ObservationPortReport {
  readonly schemaVersion: typeof ASSAY_SCHEMA_VERSION;
  readonly definition: DefinitionReference;
  readonly artifactDigest?: string;
  readonly provenance: ObservationPortProvenance;
  readonly observations: readonly Observation[];
}

export interface ObservationPortReceipt {
  readonly definition: DefinitionReference;
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
      reasonCode: "OBSERVATION_PORT_ERROR";
    }>;
