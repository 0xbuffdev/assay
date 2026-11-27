import { CONTRACT_LIMITS } from "../contracts/common";
import { choice, type DataObject, type Diagnostics, identifier, list, object } from "./shared";

/** Validate a bounded tree with exact required-leaf membership. */
export function validateComposition(
  value: unknown,
  criteria: readonly unknown[],
  issues: Diagnostics,
): void {
  const path = "$.composition";
  if (!object(value, path, ["rootGroupId", "groups"], ["rootGroupId", "groups"], issues))
    return;
  if (!identifier(value.rootGroupId, `${path}.rootGroupId`, issues)) return;
  if (!list(value.groups, `${path}.groups`, issues, CONTRACT_LIMITS.maxGroups)) return;

  const criterionModes = new Map<string, unknown>();
  for (const raw of criteria) {
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const criterion = raw as DataObject;
      if (typeof criterion.id === "string") criterionModes.set(criterion.id, criterion.mode);
    }
  }
  type Child = Readonly<{ kind: "criterion" | "group"; id: string }>;
  const groups = new Map<string, readonly Child[]>();
  let edges = 0;
  for (const [index, raw] of value.groups.entries()) {
    const gp = `${path}.groups[${index}]`;
    if (!object(raw, gp, ["id", "operator", "children"], ["id", "operator", "children"], issues))
      continue;
    const idOk = identifier(raw.id, `${gp}.id`, issues);
    choice(raw.operator, ["all", "any"], `${gp}.operator`, issues);
    if (!idOk || typeof raw.id !== "string") continue;
    if (groups.has(raw.id) || criterionModes.has(raw.id)) {
      issues.add(`${gp}.id`, "DUPLICATE_ID");
      continue;
    }
    if (!list(raw.children, `${gp}.children`, issues, CONTRACT_LIMITS.maxGroupChildren))
      continue;
    if (raw.children.length === 0) issues.add(`${gp}.children`, "INVALID_VALUE");
    edges += raw.children.length;
    if (edges > CONTRACT_LIMITS.maxCompositionEdges) {
      issues.add(path, "INVALID_VALUE");
      return;
    }
    const children: Child[] = [];
    for (const [i, child] of raw.children.entries()) {
      const cp = `${gp}.children[${i}]`;
      if (!object(child, cp, ["kind", "id"], ["kind", "id"], issues)) continue;
      const kindOk = choice(child.kind, ["criterion", "group"], `${cp}.kind`, issues);
      const childOk = identifier(child.id, `${cp}.id`, issues);
      if (
        kindOk &&
        childOk &&
        typeof child.id === "string" &&
        (child.kind === "criterion" || child.kind === "group")
      ) {
        children.push({ kind: child.kind, id: child.id });
      }
    }
    groups.set(raw.id, children);
  }

  if (typeof value.rootGroupId !== "string") return;
  const root = value.rootGroupId;
  const visited = new Set<string>();
  const leaves = new Set<string>();
  // Mark before descent: cycles and shared children cannot cause expansion.
  function visit(id: string, depth: number): void {
    if (depth > CONTRACT_LIMITS.maxGroupDepth || visited.has(id)) {
      issues.add(path, "INVALID_VALUE");
      return;
    }
    const children = groups.get(id);
    if (!children) {
      issues.add(path, "INVALID_VALUE");
      return;
    }
    visited.add(id);
    for (const child of children) {
      if (child.kind === "group") {
        visit(child.id, depth + 1);
      } else if (criterionModes.get(child.id) !== "required" || leaves.has(child.id)) {
        issues.add(path, "INVALID_VALUE");
      } else {
        leaves.add(child.id);
      }
    }
  }
  visit(root, 1);
  if (
    visited.size !== groups.size ||
    [...criterionModes].some(([id, mode]) => mode === "required" && !leaves.has(id))
  ) {
    issues.add(path, "INVALID_VALUE");
  }
}
