type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sources(staff: Json): Json[] {
  return Array.isArray(staff["sources"]) ? staff["sources"].filter(isRecord) : [];
}

function staffKey(staff: Json): string {
  return sources(staff)
    .map((source) => `${String(source["part"])}:${typeof source["staff"] === "number" ? source["staff"] : 1}`)
    .join("+");
}

function children(node: Json): unknown[] {
  return Array.isArray(node["content"]) ? node["content"] : [];
}

function isGroup(node: Json): boolean {
  return node["type"] === "group";
}

/** Staff nodes in reading order. */
export function layoutStaves(content: unknown[]): Json[] {
  return content.filter(isRecord).flatMap((node) => (isGroup(node) ? layoutStaves(children(node)) : [node]));
}

function groups(content: unknown[]): Json[] {
  return content.filter(isRecord).flatMap((node) => (isGroup(node) ? [node, ...groups(children(node))] : []));
}

function labelStyle(content: unknown[]): string | undefined {
  for (const staff of layoutStaves(content)) {
    const labelRef =
      staff["labelRef"] ?? sources(staff).find((source) => source["labelRef"] !== undefined)?.["labelRef"];
    if (isRecord(labelRef)) return typeof labelRef["ref"] === "string" ? labelRef["ref"] : "auto";
  }
  return undefined;
}

function restyledStaff(staff: Json, style: string | undefined): Json {
  const clone = structuredClone(staff);
  if (style === undefined) return clone;
  if (isRecord(clone["labelRef"])) clone["labelRef"] = { ...clone["labelRef"], ref: style };
  for (const source of sources(clone)) {
    if (isRecord(source["labelRef"])) source["labelRef"] = { ...source["labelRef"], ref: style };
  }
  return clone;
}

function sameKeys(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/**
 * Rebuild a per-system layout from the score's full layout so the staves
 * Finale left out for `restoredParts` return under automatic hiding. Staff and
 * group nodes the system already has keep their system-specific labels.
 * Returns undefined when the system layout is not the full layout minus whole
 * restored instruments, so unrelated system edits stay untouched.
 */
export function restoreSystemLayout(
  full: unknown[],
  system: unknown[],
  restoredParts: ReadonlySet<string>,
): unknown[] | undefined {
  const systemStaves = new Map(layoutStaves(system).map((staff) => [staffKey(staff), staff]));
  const fullStaves = layoutStaves(full);
  const fullKeys = fullStaves.map(staffKey);
  if (systemStaves.size !== layoutStaves(system).length) return undefined;
  const retainedOrder = fullKeys.filter((key) => systemStaves.has(key));
  if (retainedOrder.length !== systemStaves.size || retainedOrder.join("|") !== [...systemStaves.keys()].join("|")) {
    return undefined;
  }
  const omitted = fullStaves.filter((staff) => !systemStaves.has(staffKey(staff)));
  if (omitted.length === 0) return undefined;
  if (!omitted.every((staff) => sources(staff).every((source) => restoredParts.has(String(source["part"]))))) {
    return undefined;
  }

  const style = labelStyle(system);
  const systemGroups = groups(system).map((group) => ({
    group,
    keys: new Set(layoutStaves(children(group)).map(staffKey)),
    used: false,
  }));

  const rebuild = (content: unknown[]): unknown[] | undefined => {
    const result: unknown[] = [];
    for (const node of content) {
      if (!isRecord(node)) continue;
      if (!isGroup(node)) {
        const key = staffKey(node);
        result.push(structuredClone(systemStaves.get(key) ?? restyledStaff(node, style)));
        continue;
      }
      const present = new Set(
        layoutStaves(children(node))
          .map(staffKey)
          .filter((key) => systemStaves.has(key)),
      );
      let props: Json = node;
      if (present.size > 0) {
        const match = systemGroups.find((entry) => !entry.used && sameKeys(entry.keys, present));
        if (!match) return undefined;
        match.used = true;
        props = match.group;
      }
      const nested = rebuild(children(node));
      if (!nested) return undefined;
      const group = structuredClone(props);
      group["content"] = nested;
      result.push(group);
    }
    return result;
  };

  const restored = rebuild(full);
  if (!restored || systemGroups.some((entry) => !entry.used)) return undefined;
  return restored;
}
