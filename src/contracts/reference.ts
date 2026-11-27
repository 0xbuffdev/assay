import type { JsonValue, NumericRange } from "./common";
import type { DefinitionReference } from "./definition";

type ReferenceValue =
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{ kind: "boolean"; value: boolean }>
  | Readonly<{ kind: "json"; value: JsonValue }>
  | Readonly<{ kind: "range"; value: NumericRange; unit?: string }>
  | Readonly<{ kind: "number"; value: number; unit?: string }>
  | Readonly<{ kind: "set"; itemType: "string"; value: readonly string[] }>
  | Readonly<{ kind: "set"; itemType: "number"; value: readonly number[] }>
  | Readonly<{ kind: "set"; itemType: "boolean"; value: readonly boolean[] }>;

/** Privileged expected content, never an observation or an authenticated claim. */
export type ReferenceRecordDraft = Readonly<{
  schemaVersion: 2;
  referenceId: string;
}> &
  ReferenceValue;

export type ReferenceRecord = ReferenceRecordDraft & Readonly<{ referenceDigest: string }>;

export interface ReferenceBundle {
  readonly schemaVersion: 2;
  readonly definition: DefinitionReference;
  readonly references: readonly ReferenceRecord[];
}
