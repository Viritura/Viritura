export type Role = "score" | "part";
export type Category =
  | "page"
  | "spacing"
  | "staves"
  | "clefs"
  | "accidentals"
  | "beams"
  | "rests"
  | "slurs"
  | "dynamics"
  | "numbers"
  | "rehearsal"
  | "text"
  | "lyrics"
  | "chords";
export type Destination = "house" | "layout" | "selection";
/** Tabs for the viewed layout. House style is a project-level mode, not a tab. */
export const LAYOUT_TABS: { id: Exclude<Destination, "house">; label: string }[] = [
  { id: "layout", label: "Layout" },
  { id: "selection", label: "Selection" },
];
export type Field =
  | "paper"
  | "orientation"
  | "staff"
  | "marginTop"
  | "marginBottom"
  | "marginInner"
  | "marginOuter"
  | "turns"
  | "frequency"
  | "placement"
  | "size"
  | "enclosure"
  | "family"
  | "noteSpacing"
  | "systemGap"
  | "bracketStyle"
  | "courtesyClefs"
  | "cautionary"
  | "beamSlant"
  | "multiRests"
  | "slurThickness"
  | "tieStyle"
  | "hairpinCap"
  | "rehearsalStyle"
  | "lyricSize"
  | "chordStyle";
export type Settings = Partial<Record<Field, string>>;

/** Where an edit lands: the shared house-style layer, one layout profile, or a single layout. */
export type Scope = { kind: "common" } | { kind: "profile"; id: string } | { kind: "layout"; id: string };

export interface FieldDefinition {
  id: Field;
  label: string;
  options: { value: string; label: string }[];
}

export interface CategoryDefinition {
  id: Category;
  label: string;
  /** Page geometry belongs to layout profiles, never to the shared layer. */
  profileOnly?: boolean;
  fields: FieldDefinition[];
}

function choices(...values: string[]) {
  return values.map((value) => ({ value, label: value }));
}

const MARGINS = choices("8 mm", "10 mm", "12 mm", "15 mm", "20 mm", "25 mm");

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: "page",
    label: "Page and staff",
    profileOnly: true,
    fields: [
      { id: "paper", label: "Page size", options: choices("9 x 12 in", "Letter", "A4", "B4", "Tabloid", "A3") },
      { id: "orientation", label: "Orientation", options: choices("Portrait", "Landscape") },
      {
        id: "staff",
        label: "Staff size",
        options: choices("4.5 mm", "5 mm", "5.5 mm", "6 mm", "6.5 mm", "7 mm", "8 mm"),
      },
      { id: "marginTop", label: "Top margin", options: MARGINS },
      { id: "marginBottom", label: "Bottom margin", options: MARGINS },
      { id: "marginInner", label: "Inside margin", options: MARGINS },
      { id: "marginOuter", label: "Outside margin", options: MARGINS },
      { id: "turns", label: "Page-turn policy", options: choices("Standard flow", "Comfortable turns", "Dense pages") },
    ],
  },
  {
    id: "spacing",
    label: "Spacing",
    fields: [
      { id: "noteSpacing", label: "Note spacing", options: choices("Tight", "Standard", "Loose") },
      { id: "systemGap", label: "Gap between systems", options: choices("8 mm", "10 mm", "12 mm", "15 mm") },
    ],
  },
  {
    id: "staves",
    label: "Staves and brackets",
    fields: [{ id: "bracketStyle", label: "Bracket style", options: choices("Thick with hooks", "Thin", "Square") }],
  },
  {
    id: "clefs",
    label: "Clefs and keys",
    fields: [{ id: "courtesyClefs", label: "Courtesy clefs", options: choices("At system ends", "Never") }],
  },
  {
    id: "accidentals",
    label: "Accidentals",
    fields: [{ id: "cautionary", label: "Cautionary accidentals", options: choices("Parenthesized", "Plain", "Off") }],
  },
  {
    id: "beams",
    label: "Beams",
    fields: [{ id: "beamSlant", label: "Maximum slant", options: choices("Shallow", "Standard", "Steep") }],
  },
  {
    id: "rests",
    label: "Rests",
    fields: [{ id: "multiRests", label: "Multi-bar rests", options: choices("H-bar", "Church rests", "Off") }],
  },
  {
    id: "slurs",
    label: "Slurs and ties",
    fields: [
      { id: "slurThickness", label: "Slur thickness", options: choices("Thin", "Standard", "Heavy") },
      { id: "tieStyle", label: "Tie placement", options: choices("Between noteheads", "Outside noteheads") },
    ],
  },
  {
    id: "dynamics",
    label: "Dynamics and hairpins",
    fields: [{ id: "hairpinCap", label: "Hairpin opening", options: choices("Narrow", "Standard", "Wide") }],
  },
  {
    id: "numbers",
    label: "Bar numbers",
    fields: [
      { id: "frequency", label: "Frequency", options: choices("System starts", "Every bar", "Hidden") },
      { id: "placement", label: "Placement", options: choices("Below system", "Above system") },
      { id: "size", label: "Font size", options: choices("9 pt", "10 pt", "12 pt") },
      { id: "enclosure", label: "Enclosure", options: choices("None", "Box", "Circle") },
    ],
  },
  {
    id: "text",
    label: "Text styles",
    fields: [
      { id: "family", label: "Title font", options: choices("Libertinus Serif", "Arial / sans-serif", "Monospace") },
    ],
  },
  {
    id: "rehearsal",
    label: "Rehearsal marks",
    fields: [{ id: "rehearsalStyle", label: "Rehearsal mark style", options: choices("Letters", "Bar numbers") }],
  },
  {
    id: "lyrics",
    label: "Lyrics",
    fields: [{ id: "lyricSize", label: "Lyric size", options: choices("9 pt", "10 pt", "11 pt") }],
  },
  {
    id: "chords",
    label: "Chord symbols",
    fields: [{ id: "chordStyle", label: "Chord symbol style", options: choices("Standard", "Jazz", "Roman") }],
  },
];

const BUILT_IN: Record<Field, string> = {
  paper: "A4",
  orientation: "Portrait",
  staff: "6 mm",
  marginTop: "15 mm",
  marginBottom: "15 mm",
  marginInner: "15 mm",
  marginOuter: "15 mm",
  turns: "Standard flow",
  frequency: "System starts",
  placement: "Below system",
  size: "9 pt",
  enclosure: "None",
  family: "Libertinus Serif",
  noteSpacing: "Standard",
  systemGap: "12 mm",
  bracketStyle: "Thick with hooks",
  courtesyClefs: "At system ends",
  cautionary: "Parenthesized",
  beamSlant: "Standard",
  multiRests: "H-bar",
  slurThickness: "Standard",
  tieStyle: "Between noteheads",
  hairpinCap: "Standard",
  rehearsalStyle: "Letters",
  lyricSize: "10 pt",
  chordStyle: "Standard",
};

const HOUSE_FIELDS = CATEGORIES.filter((category) => !category.profileOnly).flatMap((category) =>
  category.fields.map(({ id }) => id),
);
const PROFILE_FIELDS = CATEGORIES.filter((category) => category.profileOnly).flatMap((category) =>
  category.fields.map(({ id }) => id),
);

function houseSettings(overrides: Settings): Settings {
  const settings: Settings = {};
  for (const field of HOUSE_FIELDS) settings[field] = overrides[field] ?? BUILT_IN[field];
  return settings;
}

function profileSettings(overrides: Settings): Settings {
  const settings: Settings = {};
  for (const field of PROFILE_FIELDS) settings[field] = overrides[field] ?? BUILT_IN[field];
  return { ...settings, ...overrides };
}

export interface LayoutProfile {
  id: string;
  name: string;
  role: Role;
  settings: Settings;
  /** Preset profile used as the reset baseline for duplicated profiles. */
  presetProfileId?: string;
}

export interface HouseStyle {
  id: string;
  name: string;
  description: string;
  common: Settings;
  profiles: LayoutProfile[];
}

export const PRESETS: [HouseStyle, HouseStyle] = [
  {
    id: "concert",
    name: "Classical",
    description: "9 x 12 scores at 5 mm, Letter parts at 7 mm, plus a large-print part profile.",
    common: houseSettings({ frequency: "System starts", size: "9 pt", enclosure: "None" }),
    profiles: [
      {
        id: "score",
        name: "Score",
        role: "score",
        settings: profileSettings({
          paper: "9 x 12 in",
          staff: "5 mm",
          marginTop: "12 mm",
          marginBottom: "12 mm",
        }),
      },
      {
        id: "part",
        name: "Part",
        role: "part",
        settings: profileSettings({
          paper: "Letter",
          staff: "7 mm",
          marginInner: "15 mm",
          turns: "Comfortable turns",
        }),
      },
      {
        id: "large-part",
        name: "Large-print part",
        role: "part",
        settings: profileSettings({
          paper: "Tabloid",
          staff: "8 mm",
          marginInner: "20 mm",
          size: "12 pt",
          turns: "Comfortable turns",
        }),
      },
    ],
  },
  {
    id: "film",
    name: "Film",
    description: "Tabloid landscape scores, every-bar boxed numbers, 9 x 12 parts.",
    common: houseSettings({ frequency: "Every bar", placement: "Above system", size: "12 pt", enclosure: "Box" }),
    profiles: [
      {
        id: "score",
        name: "Conductor score",
        role: "score",
        settings: profileSettings({
          paper: "Tabloid",
          orientation: "Landscape",
          staff: "5 mm",
          marginTop: "10 mm",
        }),
      },
      {
        id: "part",
        name: "Part",
        role: "part",
        settings: profileSettings({ paper: "9 x 12 in", staff: "6.5 mm", turns: "Comfortable turns" }),
      },
    ],
  },
];

export interface MockLayout {
  id: string;
  name: string;
  /** What the layout is (navigator grouping); the profile decides how it is printed. */
  role: Role;
  profileId: string;
  staves: number;
  bars: number;
  overrides: Settings;
  bracket: boolean;
  manualBreaks: number;
}

export interface Project {
  style: HouseStyle;
  /** The preset this project's house style was adopted from. */
  origin: { id: string; name: string };
  layouts: MockLayout[];
}

function layoutEntry(
  id: string,
  name: string,
  role: Role,
  profileId: string,
  extra: Partial<MockLayout> = {},
): MockLayout {
  return {
    id,
    name,
    role,
    profileId,
    staves: 1,
    bars: 96,
    overrides: {},
    bracket: false,
    manualBreaks: 0,
    ...extra,
  };
}

export function initialProject(): Project {
  const style = structuredClone(PRESETS[0]);
  return {
    style,
    origin: { id: style.id, name: style.name },
    layouts: [
      layoutEntry("full", "Full score", "score", "score", {
        staves: 6,
        overrides: { size: "10 pt" },
        bracket: true,
        manualBreaks: 2,
      }),
      layoutEntry("flute", "Flute", "part", "part"),
      layoutEntry("clarinet", "Clarinet in Bb", "part", "part"),
      layoutEntry("horn", "Horn in F", "part", "large-part"),
      layoutEntry("violin", "Violin I", "part", "part"),
      layoutEntry("cello", "Cello", "part", "part", {
        overrides: { marginInner: "20 mm", frequency: "Every bar" },
        manualBreaks: 1,
      }),
    ],
  };
}

export function findLayout(project: Project, id: string): MockLayout {
  const layout = project.layouts.find((entry) => entry.id === id);
  if (!layout) throw new Error(`Unknown mock layout: ${id}`);
  return layout;
}

export function findProfile(project: Project, id: string): LayoutProfile {
  const profile = project.style.profiles.find((entry) => entry.id === id);
  if (!profile) throw new Error(`Unknown mock profile: ${id}`);
  return profile;
}

export function categoryDefinition(id: Category): CategoryDefinition {
  const category = CATEGORIES.find((entry) => entry.id === id);
  if (!category) throw new Error(`Unknown category: ${id}`);
  return category;
}

export function scopeLabel(project: Project, scope: Scope): string {
  if (scope.kind === "common") return `${project.style.name} / Shared`;
  if (scope.kind === "profile") return `${project.style.name} / ${findProfile(project, scope.id).name} profile`;
  return findLayout(project, scope.id).name;
}

export function layer(project: Project, scope: Scope): Settings {
  if (scope.kind === "common") return project.style.common;
  if (scope.kind === "profile") return findProfile(project, scope.id).settings;
  return findLayout(project, scope.id).overrides;
}

function presetHouseValue(project: Project, field: Field): string {
  const preset = PRESETS.find((style) => style.id === project.origin.id);
  return preset?.common[field] ?? BUILT_IN[field];
}

/** The preset profile's own value; undefined for house-controlled fields the preset profile inherits. */
function presetProfileValue(project: Project, profile: LayoutProfile, field: Field): string | undefined {
  const preset = PRESETS.find((style) => style.id === project.origin.id);
  const baselineId = profile.presetProfileId ?? profile.id;
  const baseline =
    preset?.profiles.find((entry) => entry.id === baselineId) ??
    preset?.profiles.find((entry) => entry.role === profile.role);
  return baseline?.settings[field] ?? (isProfileOnly(field) ? BUILT_IN[field] : undefined);
}

/** Whether this layer differs from what resetting it would restore. */
export function isModifiedAtScope(project: Project, scope: Scope, field: Field): boolean {
  const value = layer(project, scope)[field];
  if (scope.kind === "common") return value !== presetHouseValue(project, field);
  if (scope.kind === "profile") return value !== presetProfileValue(project, findProfile(project, scope.id), field);
  return value !== undefined;
}

/** Resolution: layout override, then profile, then the house layer. Page geometry is profile-owned. */
export function resolveField(project: Project, scope: Scope, field: Field): { value: string; source: string } {
  const chain: { settings: Settings; source: string }[] = [];
  let profile: LayoutProfile | undefined;
  if (scope.kind === "layout") {
    const layout = findLayout(project, scope.id);
    chain.push({ settings: layout.overrides, source: "This layout" });
    profile = findProfile(project, layout.profileId);
  } else if (scope.kind === "profile") {
    profile = findProfile(project, scope.id);
  }
  if (profile) chain.push({ settings: profile.settings, source: `${profile.name} profile` });
  chain.push({ settings: project.style.common, source: "House style shared" });
  const match = chain.find(({ settings }) => settings[field] !== undefined);
  if (!match) throw new Error(`No value defined for ${field} in ${scopeLabel(project, scope)}`);
  return { value: match.settings[field]!, source: match.source };
}

export function resolveLayout(project: Project, layout: MockLayout, field: Field): string {
  return resolveField(project, { kind: "layout", id: layout.id }, field).value;
}

export function affectedLayouts(project: Project, scope: Scope): MockLayout[] {
  if (scope.kind === "common") return project.layouts;
  if (scope.kind === "profile") return project.layouts.filter((layout) => layout.profileId === scope.id);
  return [findLayout(project, scope.id)];
}

export type Level = "house" | "profile" | "layout";

export interface ChainStep {
  level: Level;
  name: string;
  scope: Scope;
  value?: string;
}

function isProfileOnly(field: Field): boolean {
  return CATEGORIES.some((category) => category.profileOnly && category.fields.some(({ id }) => id === field));
}

/** The layers that can set `field` for `scope`, broadest first. Page geometry starts at the profile. */
export function fieldChain(project: Project, scope: Scope, field: Field): ChainStep[] {
  const steps: ChainStep[] = [];
  if (!isProfileOnly(field)) {
    steps.push({ level: "house", name: "House", scope: { kind: "common" }, value: project.style.common[field] });
  }
  if (scope.kind === "common") return steps;
  const layout = scope.kind === "layout" ? findLayout(project, scope.id) : undefined;
  const profile = findProfile(project, layout ? layout.profileId : scope.id);
  steps.push({
    level: "profile",
    name: profile.name,
    scope: { kind: "profile", id: profile.id },
    value: profile.settings[field],
  });
  if (layout) steps.push({ level: "layout", name: layout.name, scope, value: layout.overrides[field] });
  return steps;
}

/** The value and source `scope` uses when its own setting is reset. */
export function inheritedValue(project: Project, scope: Scope, field: Field): { value: string; source: string } {
  if (scope.kind === "common") {
    return { value: presetHouseValue(project, field), source: `${project.origin.name} preset` };
  }
  if (scope.kind === "profile") {
    const preset = presetProfileValue(project, findProfile(project, scope.id), field);
    if (preset !== undefined) return { value: preset, source: `${project.origin.name} preset` };
  }
  const upstream = fieldChain(project, scope, field).slice(0, -1);
  const match = [...upstream].reverse().find((step) => step.value !== undefined);
  if (!match) throw new Error(`No inherited value defined for ${field} in ${scopeLabel(project, scope)}`);
  return { value: match.value!, source: match.name };
}

export interface DownstreamOverride {
  scope: Scope;
  name: string;
  value: string;
}

/** More specific layers under `scope` that set their own value, so edits here do not reach them. */
export function downstreamOverrides(project: Project, scope: Scope, field: Field): DownstreamOverride[] {
  if (scope.kind === "layout") return [];
  const result: DownstreamOverride[] = [];
  if (scope.kind === "common") {
    for (const profile of project.style.profiles) {
      const value = profile.settings[field];
      if (value !== undefined) result.push({ scope: { kind: "profile", id: profile.id }, name: profile.name, value });
    }
  }
  for (const layout of affectedLayouts(project, scope)) {
    const value = layout.overrides[field];
    if (value !== undefined) result.push({ scope: { kind: "layout", id: layout.id }, name: layout.name, value });
  }
  return result;
}

export function resetDownstream(project: Project, scope: Scope, field: Field): Project {
  const next = structuredClone(project);
  for (const entry of downstreamOverrides(project, scope, field)) delete layer(next, entry.scope)[field];
  return next;
}

/** The next broader layer a value can be moved to, if any. */
export function parentScope(project: Project, scope: Scope, field: Field): Scope | undefined {
  if (scope.kind === "layout") return { kind: "profile", id: findLayout(project, scope.id).profileId };
  if (scope.kind === "profile" && !isProfileOnly(field)) return { kind: "common" };
  return undefined;
}

/** Moves a value up one layer so every sibling that inherits picks it up. */
export function promoteField(project: Project, scope: Scope, field: Field): Project {
  const parent = parentScope(project, scope, field);
  const value = layer(project, scope)[field];
  if (!parent || value === undefined) return project;
  const next = changeField(project, parent, field, value);
  delete layer(next, scope)[field];
  return next;
}

export function changeField(project: Project, scope: Scope, field: Field, value?: string): Project {
  const next = structuredClone(project);
  const settings = layer(next, scope);
  const baseline =
    scope.kind === "common"
      ? presetHouseValue(project, field)
      : scope.kind === "profile"
        ? presetProfileValue(project, findProfile(project, scope.id), field)
        : undefined;
  const target = value ?? baseline;
  if (target === undefined) delete settings[field];
  else settings[field] = target;
  return next;
}

export function clearCategory(project: Project, scope: Scope, category: Category): Project {
  return categoryDefinition(category).fields.reduce((current, { id }) => changeField(current, scope, id), project);
}

/** Moves a layout override into its profile so every layout using the profile picks it up. */
export function promoteOverride(project: Project, layoutId: string, field: Field): Project {
  return promoteField(project, { kind: "layout", id: layoutId }, field);
}

export function assignProfile(project: Project, layoutId: string, profileId: string): Project {
  findProfile(project, profileId);
  return {
    ...project,
    layouts: project.layouts.map((layout) => (layout.id === layoutId ? { ...layout, profileId } : layout)),
  };
}

export function duplicateProfile(project: Project, sourceId: string, name: string): { project: Project; id: string } {
  const source = findProfile(project, sourceId);
  const next = structuredClone(project);
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") || "profile";
  let id = base;
  for (let index = 2; next.style.profiles.some((entry) => entry.id === id); index += 1) id = `${base}-${index}`;
  next.style.profiles.push({
    ...structuredClone(source),
    id,
    name: name.trim(),
    presetProfileId: source.presetProfileId ?? source.id,
  });
  return { project: next, id };
}

/** Removes a profile, moving its layouts to another profile with the same role. Never removes a role's last profile. */
export function deleteProfile(project: Project, profileId: string): Project {
  const profile = findProfile(project, profileId);
  const fallback = project.style.profiles.find((entry) => entry.id !== profileId && entry.role === profile.role);
  if (!fallback) return project;
  const next = structuredClone(project);
  next.style.profiles = next.style.profiles.filter((entry) => entry.id !== profileId);
  for (const layout of next.layouts) if (layout.profileId === profileId) layout.profileId = fallback.id;
  return next;
}

/**
 * Replaces the project house style. Layout overrides, bracket choices and manual breaks are untouched.
 * Layouts keep a profile with the same id when the new style has one, otherwise the first profile for their role.
 */
export function adoptStyle(project: Project, style: HouseStyle): Project {
  const next = structuredClone(style);
  const fallback = (role: Role) => next.profiles.find((profile) => profile.role === role) ?? next.profiles[0]!;
  return {
    style: next,
    origin: { id: style.id, name: style.name },
    layouts: project.layouts.map((layout) => ({
      ...layout,
      profileId: next.profiles.some((profile) => profile.id === layout.profileId)
        ? layout.profileId
        : fallback(layout.role).id,
    })),
  };
}

export function isModifiedFromOrigin(project: Project): boolean {
  const origin = PRESETS.find((style) => style.id === project.origin.id);
  if (!origin) return true;
  const comparable = (style: HouseStyle) => JSON.stringify({ common: style.common, profiles: style.profiles });
  return comparable(origin) !== comparable(project.style);
}

export function copyCategory(project: Project, sourceId: string, targets: string[], category: Category): Project {
  const source = findLayout(project, sourceId);
  const next = structuredClone(project);
  for (const target of next.layouts.filter((entry) => targets.includes(entry.id))) {
    for (const { id } of categoryDefinition(category).fields) target.overrides[id] = resolveLayout(project, source, id);
  }
  return next;
}
