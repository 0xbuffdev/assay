import type { DefinitionReference } from "./definition";
import type { EvidenceBundle, ObservationFact, ObservationPortProvenance } from "./evidence";
import type { ValidationDiagnostic } from "./validation";

/**
 * The requested facts contain no reference answers, hidden test definitions,
 * grader source, executable commands or untrusted callbacks.
 */
export type ObservationPortKind = "text" | "number" | "set" | "execution" | "boolean" | "json";
export type ObservationPortCriterion = Readonly<{
  criterionId: string;
  kind: ObservationPortKind;
  /** Public unit metadata for numeric observations, never an expected value. */
  unit?: string;
  assertionIds?: readonly string[];
}>;

export interface ObservationPortRequest {
  readonly schemaVersion: 2;
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

export interface ObservationPortReport {
  readonly schemaVersion: 2;
  readonly definition: DefinitionReference;
  readonly artifactDigest?: string;
  readonly provenance: ObservationPortProvenance;
  readonly observations: readonly ObservationFact[];
}

export interface ObservationPortReceipt {
  readonly definition: DefinitionReference;
  readonly evidenceDigest: string;
  readonly evidenceRefs: readonly string[];
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
