import { useState } from "react";
import { Badge, Button, SearchInput } from "@viritura/ui";
import {
  affectedLayouts,
  findProfile,
  overrideSummary,
  type MockLayout,
  type Project,
  type Role,
  type Scope,
} from "./styleModel";
import { pageGeometry } from "./pageGeometry";
import styles from "./StyleWorkbench.module.css";

interface NavigatorProps {
  project: Project;
  viewId: string;
  editing: Scope;
  onView: (id: string) => void;
}

const GROUPS: { role: Role; label: string }[] = [
  { role: "score", label: "Scores" },
  { role: "part", label: "Parts" },
];

function LayoutRow({
  project,
  layout,
  viewing,
  affected,
  onView,
}: {
  project: Project;
  layout: MockLayout;
  viewing: boolean;
  affected: boolean;
  onView: (id: string) => void;
}) {
  const custom = overrideSummary(layout);
  return (
    <Button
      fullWidth
      variant="ghost"
      active={viewing}
      onClick={() => onView(layout.id)}
      className={styles.layoutButton}
      ariaLabel={`View ${layout.name}`}
    >
      <span>
        <span className={styles.layoutName}>
          {layout.name}
          {affected && <span className={styles.affectedDot} aria-label="Affected by current edit" />}
        </span>
        <small>
          {findProfile(project, layout.profileId).name} / {pageGeometry(project, layout).pages} pp
        </small>
        <small className={custom.length ? styles.customText : undefined}>
          {custom.length ? `Custom: ${custom.join(", ")}` : "Follows house style"}
        </small>
      </span>
    </Button>
  );
}

export function LayoutNavigator({ project, viewId, editing, onView }: NavigatorProps) {
  const [query, setQuery] = useState("");
  const affected = new Set(affectedLayouts(project, editing).map((layout) => layout.id));
  const matches = project.layouts.filter((layout) => layout.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <nav className={styles.rail} aria-label="Layouts">
      <div className={styles.railSection}>
        <span className={styles.eyebrow}>Layouts</span>
        <SearchInput size="sm" value={query} onValueChange={setQuery} placeholder="Filter layouts" clearOnEscape />
      </div>
      {GROUPS.map(({ role, label }) => {
        const rows = matches.filter((layout) => layout.role === role);
        if (!rows.length) return null;
        return (
          <section className={styles.railSection} key={role} aria-label={label}>
            <span className={styles.groupHeading}>
              {label}
              <Badge variant="muted">{rows.length}</Badge>
            </span>
            {rows.map((layout) => (
              <LayoutRow
                key={layout.id}
                project={project}
                layout={layout}
                viewing={layout.id === viewId}
                affected={affected.has(layout.id)}
                onView={onView}
              />
            ))}
          </section>
        );
      })}
      {!matches.length && <p className={styles.railFooter}>No layouts match.</p>}
      <div className={styles.railFooter}>
        <span className={styles.affectedDot} /> Affected by the current edit. Selecting a layout changes the preview,
        not what you are editing.
      </div>
    </nav>
  );
}
