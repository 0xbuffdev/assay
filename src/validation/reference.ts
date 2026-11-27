import { CONTRACT_LIMITS } from "../contracts/common";
import type {
  ReferenceBundle,
  ReferenceRecord,
  ReferenceRecordDraft,
} from "../contracts/reference";
import type { ValidationResult } from "../contracts/validation";
import {
  choice,
  type Diagnostics,
  definitionRef,
  digest,
  finish,
  identifier,
  list,
  numberValue,
  object,
  setItems,
  textValue,
} from "./shared";

function record(input: unknown, path: string, sealed: boolean, issues: Diagnostics): void {
  const common = ["schemaVersion", "referenceId", "kind", "value"];
  if (sealed) common.push("referenceDigest");
  if (!object(input, path, [...common, "unit", "itemType"], common, issues)) return;
  if (input.schemaVersion !== 2) issues.add(`${path}.schemaVersion`, "UNSUPPORTED_VERSION");
  identifier(input.referenceId, `${path}.referenceId`, issues);
  if (sealed) digest(input.referenceDigest, `${path}.referenceDigest`, issues);
  switch (input.kind) {
    case "text":
      object(input, path, common, [], issues);
      textValue(input.value, `${path}.value`, issues);
      break;
    case "number":
      object(input, path, [...common, "unit"], [], issues);
      numberValue(input.value, `${path}.value`, issues);
      if (Object.hasOwn(input, "unit")) identifier(input.unit, `${path}.unit`, issues);
      break;
    case "set":
      object(input, path, [...common, "itemType"], ["itemType"], issues);
      choice(input.itemType, ["string", "number", "boolean"], `${path}.itemType`, issues);
      setItems(input.value, input.itemType, `${path}.value`, issues);
      break;
    default:
      issues.add(`${path}.kind`, "INVALID_VALUE");
  }
}

export function parseReferenceDraft(input: unknown): ValidationResult<ReferenceRecordDraft> {
  return finish(input, "invalid_reference", (data, issues) => record(data, "$", false, issues));
}

export function parseReferenceRecord(input: unknown): ValidationResult<ReferenceRecord> {
  return finish(input, "invalid_reference", (data, issues) => record(data, "$", true, issues));
}

export function parseReferenceBundle(input: unknown): ValidationResult<ReferenceBundle> {
  return finish(input, "invalid_reference", (data, issues) => {
    const keys = ["schemaVersion", "definition", "references"];
    if (!object(data, "$", keys, keys, issues)) return;
    if (data.schemaVersion !== 2) issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    definitionRef(data.definition, "$.definition", issues);
    if (!list(data.references, "$.references", issues, CONTRACT_LIMITS.maxCriteria)) return;
    const ids = new Set<string>();
    for (const [i, item] of data.references.entries()) {
      const path = `$.references[${i}]`;
      record(item, path, true, issues);
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const id = (item as Record<string, unknown>).referenceId;
        if (typeof id === "string") {
          if (ids.has(id)) issues.add(`${path}.referenceId`, "DUPLICATE_ID");
          ids.add(id);
        }
      }
    }
  });
}
