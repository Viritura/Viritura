import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Button, ButtonGroup, Checkbox, IconButton } from "@viritura/ui";
import { affectedLayouts, findProfile, type MockLayout, type Project, type Scope } from "./styleModel";
import { pageGeometry, paperLabel } from "./pageGeometry";
import { PageSheet } from "./PageSheet";
import styles from "./StyleWorkbench.module.css";

interface PreviewProps {
  project: Project;
  layout: MockLayout;
  editing: Scope;
  editingLabel: string;
  onView: (id: string) => void;
}

export function ScorePreview({ project, layout, editing, editingLabel, onView }: PreviewProps) {
  const [mode, setMode] = useState<"page" | "overview">("page");
  const [showMargins, setShowMargins] = useState(true);
  const affected = new Set(affectedLayouts(project, editing).map((entry) => entry.id));
  const index = project.layouts.findIndex((entry) => entry.id === layout.id);
  const step = (offset: number) => {
    const next = project.layouts.at((index + offset) % project.layouts.length);
    if (next) onView(next.id);
  };
  const geometry = pageGeometry(project, layout);
  const profile = findProfile(project, layout.profileId);
  return (
    <section className={styles.preview} aria-label="Project preview">
      <div className={styles.context}>
        <div>
          <span className={styles.eyebrow}>Viewing</span>
          <strong>{layout.name}</strong>
          <small>{profile.name} profile</small>
        </div>
        <div>
          <span className={styles.eyebrow}>Editing</span>
          <strong>{editingLabel}</strong>
          {!affected.has(layout.id) && <small>Not shown in this preview</small>}
        </div>
      </div>
      <div className={styles.previewHeading}>
        <div className={styles.toolbar}>
          <IconButton tooltip="Previous layout" onClick={() => step(-1)}>
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton tooltip="Next layout" onClick={() => step(1)}>
            <ChevronRight size={16} />
          </IconButton>
          <span className={styles.hint}>
            {index + 1} of {project.layouts.length}
          </span>
        </div>
        <ButtonGroup
          ariaLabel="Preview mode"
          options={[
            { value: "page", label: "Page" },
            { value: "overview", label: "All layouts" },
          ]}
          value={mode}
          onChange={setMode}
        />
        <Checkbox label="Margins" checked={showMargins} onChange={(event) => setShowMargins(event.target.checked)} />
      </div>
      {mode === "page" ? (
        <>
          <div className={styles.paperWell}>
            <div className={styles.paper}>
              <PageSheet project={project} layout={layout} showMargins={showMargins} />
            </div>
          </div>
          <p className={styles.previewFacts}>
            {paperLabel(project, layout)} staff / {geometry.barsPerSystem} bars per system / about {geometry.pages}{" "}
            pages
          </p>
        </>
      ) : (
        <div className={styles.overview}>
          {project.layouts.map((entry) => (
            <Button
              key={entry.id}
              variant="ghost"
              active={entry.id === layout.id}
              ariaLabel={`View ${entry.name}`}
              className={[
                styles.thumbnail,
                entry.id === layout.id ? styles.thumbnailViewing : "",
                affected.has(entry.id) ? styles.thumbnailAffected : "",
              ].join(" ")}
              onClick={() => onView(entry.id)}
            >
              <PageSheet project={project} layout={entry} showMargins={showMargins} label={`${entry.name} thumbnail`} />
              <strong>{entry.name}</strong>
              <small>
                {paperLabel(project, entry)} / {pageGeometry(project, entry).pages} pp
              </small>
              {affected.has(entry.id) && <Badge variant="accent">In scope</Badge>}
            </Button>
          ))}
        </div>
      )}
      <p className={styles.previewNote}>Mock preview · page counts are estimates</p>
    </section>
  );
}
