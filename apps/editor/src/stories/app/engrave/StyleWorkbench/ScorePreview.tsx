import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Checkbox, IconButton } from "@viritura/ui";
import { findProfile, type MockLayout, type Project } from "./styleModel";
import { pageGeometry, paperLabel } from "./pageGeometry";
import { PageSheet } from "./PageSheet";
import styles from "./StyleWorkbench.module.css";

interface PreviewProps {
  project: Project;
  layout: MockLayout;
  editingLabel: string;
  onView: (id: string) => void;
}

export function ScorePreview({ project, layout, editingLabel, onView }: PreviewProps) {
  const [showMargins, setShowMargins] = useState(true);
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
        <Checkbox label="Margins" checked={showMargins} onChange={(event) => setShowMargins(event.target.checked)} />
      </div>
      <div className={styles.paperWell}>
        <div className={styles.paper}>
          <PageSheet project={project} layout={layout} showMargins={showMargins} />
        </div>
      </div>
      <p className={styles.previewFacts}>
        {paperLabel(project, layout)} staff / {geometry.barsPerSystem} bars per system / about {geometry.pages} pages
      </p>
      <p className={styles.previewNote}>Mock preview · page counts are estimates</p>
    </section>
  );
}
