import type { ASSAY_SCHEMA_VERSION, Completeness, SetItemType, SetScalar } from "./common";
import type { DefinitionReference } from "./definition";

export type ObservationBase = Readonly<{
  criterionId: string;
  evidenceRef: string;
  completeness: Completeness;
}>;

export type Observation =
  | (ObservationBase & Readonly<{ kind: "text"; value: string }>)
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

export interface EvidenceBundle {
  readonly schemaVersion: typeof ASSAY_SCHEMA_VERSION;
  readonly definition: DefinitionReference;
  readonly artifactDigest?: string;
  readonly observations: readonly Observation[];
}
