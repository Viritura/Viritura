type Role = "score" | "part";
export type Scope = "common" | Role | "layout";
export type Category = "page" | "numbers" | "text";
export type Navigation = "tabs" | "scope-first";
export type Destination = "project" | "layout" | "selection";
export const DESTINATIONS: { id: Destination; label: string }[] = [
  { id: "project", label: "Project Style" },
  { id: "layout", label: "This Layout" },
  { id: "selection", label: "Selection" },
];
export const SCOPES: { value: Exclude<Scope, "layout">; label: string }[] = [
  { value: "common", label: "Common" },
  { value: "score", label: "Scores" },
  { value: "part", label: "Parts" },
];
export type Field =
  "paper" | "staff" | "margin" | "turns" | "frequency" | "placement" | "size" | "enclosure" | "family";
export type Settings = Partial<Record<Field, string>>;

interface FieldDefinition {
  id: Field;
  label: string;
  options: { value: string; label: string }[];
}

export interface CategoryDefinition {
  id: Category;
  label: string;
  description: string;
  fields: FieldDefinition[];
}

function choices(...values: string[]) {
  return values.map((value) => ({ value, label: value }));
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: "page",
    label: "Page layout",
    description: "Page geometry and automatic casting policy.",
    fields: [
      { id: "paper", label: "Page size", options: choices("9 x 12 in", "Letter", "A4") },
      { id: "staff", label: "Staff size", options: choices("5 mm", "6 mm", "7 mm") },
      { id: "margin", label: "Inner margin", options: choices("12 mm", "15 mm", "20 mm") },
      { id: "turns", label: "Page-turn policy", options: choices("Standard flow", "Comfortable turns", "Dense pages") },
    ],
  },
  {
    id: "numbers",
    label: "Bar numbers",
    description: "Shared appearance, with specific bracket placement on each layout.",
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
    description: "A small typography sample for exploring style inheritance.",
    fields: [
      { id: "family", label: "Title font", options: choices("Libertinus Serif", "Arial / sans-serif", "Monospace") },
    ],
  },
];

const BASE: Record<Field, string> = {
  paper: "A4",
  staff: "6 mm",
  margin: "15 mm",
  turns: "Standard flow",
  frequency: "System starts",
  placement: "Below system",
  size: "9 pt",
  enclosure: "None",
  family: "Libertinus Serif",
};

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  common: Settings;
  score: Settings;
  part: Settings;
}

export const PRESETS: [StylePreset, StylePreset] = [
  {
    id: "concert",
    name: "Concert",
    description: "Traditional numbering, 9 x 12 scores and Letter parts.",
    common: { frequency: "System starts", size: "9 pt", enclosure: "None" },
    score: { paper: "9 x 12 in", staff: "5 mm", turns: "Standard flow" },
    part: { paper: "Letter", staff: "7 mm", turns: "Comfortable turns" },
  },
  {
    id: "film",
    name: "Film",
    description: "Every-bar numbering above the system, with boxed numbers.",
    common: { frequency: "Every bar", placement: "Above system", size: "12 pt", enclosure: "Box" },
    score: { paper: "9 x 12 in", staff: "6 mm", turns: "Standard flow" },
    part: { paper: "Letter", staff: "7 mm", turns: "Comfortable turns" },
  },
];

export interface MockLayout {
  id: string;
  name: string;
  role: Role;
  overrides: Settings;
  bracket: boolean;
  manualBreaks: number;
}

export interface Project {
  adopted: StylePreset;
  adjustments: Record<"common" | Role, Settings>;
  layouts: MockLayout[];
}

export function initialProject(): Project {
  return {
    adopted: structuredClone(PRESETS[0]),
    adjustments: { common: {}, score: {}, part: {} },
    layouts: [
      { id: "full", name: "Full score", role: "score", overrides: { size: "10 pt" }, bracket: true, manualBreaks: 2 },
      { id: "violin", name: "Violin I", role: "part", overrides: {}, bracket: false, manualBreaks: 0 },
      {
        id: "cello",
        name: "Cello",
        role: "part",
        overrides: { margin: "20 mm", frequency: "Every bar" },
        bracket: false,
        manualBreaks: 1,
      },
    ],
  };
}

export function layer(project: Project, scope: Scope, layout: MockLayout): Settings {
  return scope === "layout" ? layout.overrides : project.adjustments[scope];
}

export function resolveField(
  project: Project,
  scope: Scope,
  layout: MockLayout,
  field: Field,
): { value: string; source: string } {
  const role = scope === "layout" ? layout.role : scope;
  const candidates: { settings: Settings; source: string }[] = [
    ...(scope === "layout" ? [{ settings: layout.overrides, source: "This layout" }] : []),
    ...(role !== "common"
      ? [
          { settings: project.adjustments[role], source: `Project ${role === "score" ? "Scores" : "Parts"}` },
          {
            settings: project.adopted[role],
            source: `${project.adopted.name} / ${role === "score" ? "Scores" : "Parts"}`,
          },
        ]
      : []),
    { settings: project.adjustments.common, source: "Project Common" },
    { settings: project.adopted.common, source: `${project.adopted.name} / Common` },
  ];
  const match = candidates.find(({ settings }) => settings[field] !== undefined);
  return match
    ? { value: match.settings[field]!, source: match.source }
    : { value: BASE[field], source: "Built-in default" };
}

export function changeField(project: Project, scope: Scope, layoutId: string, field: Field, value?: string): Project {
  const next = structuredClone(project);
  const layout = next.layouts.find((entry) => entry.id === layoutId);
  if (!layout) throw new Error(`Unknown mock layout: ${layoutId}`);
  const settings = layer(next, scope, layout);
  if (value === undefined) delete settings[field];
  else settings[field] = value;
  return next;
}

export function clearCategory(project: Project, scope: Scope, layoutId: string, category: Category): Project {
  const fields = CATEGORIES.find((entry) => entry.id === category)!.fields;
  return fields.reduce((current, { id }) => changeField(current, scope, layoutId, id), project);
}

export function adoptPreset(project: Project, preset: StylePreset, preserveAdjustments: boolean): Project {
  return {
    ...project,
    adopted: structuredClone(preset),
    adjustments: preserveAdjustments ? structuredClone(project.adjustments) : { common: {}, score: {}, part: {} },
  };
}

export function copyCategory(project: Project, sourceId: string, targets: string[], category: Category): Project {
  const source = project.layouts.find((entry) => entry.id === sourceId);
  if (!source) throw new Error(`Unknown mock layout: ${sourceId}`);
  const next = structuredClone(project);
  for (const target of next.layouts.filter((entry) => targets.includes(entry.id))) {
    for (const { id } of CATEGORIES.find((entry) => entry.id === category)!.fields) {
      target.overrides[id] = resolveField(project, "layout", source, id).value;
    }
  }
  return next;
}
