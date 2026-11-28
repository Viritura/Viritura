import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Badge, Button, Select, TooltipPrimitives } from "@viritura/ui";
import {
  findLayout,
  initialProject,
  isModifiedFromOrigin,
  scopeLabel,
  type Category,
  type Destination,
  type Project,
  type Scope,
} from "./styleModel";
import { HouseStyleEditor } from "./HouseStyleEditor";
import { LayoutEditor, SelectionPlaceholder } from "./LayoutEditor";
import { HouseStyleEntry, PanelModeHeader } from "./ModeSwitch";
import type { OpenCategories } from "./CategoryBrowser";
import { ScorePreview } from "./ScorePreview";
import { NewProfileDialog, OverridesReview, StylePresets, TransferSettings } from "./StyleDialogs";
import styles from "./StyleWorkbench.module.css";

interface WorkbenchProps {
  initialDestination?: Destination;
}

type DialogKind = "presets" | "overrides" | "transfer" | "profile" | null;

export function StyleWorkbench({ initialDestination = "layout" }: WorkbenchProps) {
  const [project, setProject] = useState(initialProject);
  const [history, setHistory] = useState<Project[]>([]);
  const [viewId, setViewId] = useState("violin");
  const [destination, setDestination] = useState<Destination>(initialDestination);
  const [requestedScope, setStyleScope] = useState<Scope>({ kind: "profile", id: "part" });
  const [openCategories, setOpenCategories] = useState<OpenCategories>({ page: true });
  const [transferCategory, setTransferCategory] = useState<Category>("page");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [status, setStatus] = useState("");
  const layout = findLayout(project, viewId);
  const styleScope: Scope =
    requestedScope.kind === "profile" && !project.style.profiles.some((entry) => entry.id === requestedScope.id)
      ? { kind: "common" }
      : requestedScope;
  const editing: Scope = destination === "house" ? styleScope : { kind: "layout", id: layout.id };
  const modified = isModifiedFromOrigin(project);
  const totalCustomSettings = project.layouts.reduce((count, entry) => count + Object.keys(entry.overrides).length, 0);
  function commit(next: Project, message: string) {
    setHistory((current) => [...current, project]);
    setProject(next);
    setStatus(message);
  }
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setProject(previous);
    setHistory((current) => current.slice(0, -1));
    setStatus("Undid the last change.");
  }
  function editProfile(id: string) {
    setStyleScope({ kind: "profile", id });
    setDestination("house");
  }
  function jump(scope: Scope) {
    if (scope.kind === "layout") {
      setViewId(scope.id);
      setDestination("layout");
      return;
    }
    setStyleScope(scope);
    setDestination("house");
  }
  return (
    <TooltipPrimitives.Provider>
      <div className={styles.root}>
        <header className={styles.prototypeBar}>
          <div>
            <Badge variant="warning">Design sandbox</Badge>
            <strong>Engrave</strong>
          </div>
          <div className={styles.toolbar}>
            <Button
              size="sm"
              onClick={() => {
                setProject(initialProject());
                setHistory([]);
                setStatus("Reset all mock data.");
              }}
            >
              Reset demo
            </Button>
          </div>
        </header>
        <header className={styles.projectBar}>
          <div>
            <h1>Evening Sketches</h1>
          </div>
          <div className={styles.switcher}>
            <Select
              aria-label="Active layout"
              value={viewId}
              options={project.layouts.map((entry) => {
                const profile = project.style.profiles.find((candidate) => candidate.id === entry.profileId);
                if (!profile) throw new Error(`Unknown layout profile: ${entry.profileId}`);
                const customCount = Object.keys(entry.overrides).length;
                return {
                  value: entry.id,
                  label: `${entry.name} · ${entry.role === "score" ? "Score" : "Part"}`,
                  badge: `${profile.name}${customCount ? ` · ${customCount} custom` : ""}`,
                };
              })}
              onValueChange={setViewId}
            />
          </div>
          <div className={styles.toolbar}>
            <HouseStyleEntry
              name={project.style.name}
              modified={modified}
              destination={destination}
              onDestination={setDestination}
            />
            <Button onClick={() => setDialog("overrides")}>
              {totalCustomSettings} {totalCustomSettings === 1 ? "custom setting" : "custom settings"}
            </Button>
            <Button ariaLabel="Undo change" tooltip="Undo change" disabled={!history.length} onClick={undo}>
              <Undo2 size={15} />
              Undo
            </Button>
          </div>
        </header>
        <div className={styles.workspaceCompact}>
          <main className={styles.editor}>
            <PanelModeHeader destination={destination} onDestination={setDestination} />
            {destination === "house" && (
              <HouseStyleEditor
                project={project}
                scope={styleScope}
                viewing={layout}
                openCategories={openCategories}
                onScope={setStyleScope}
                onOpenCategories={setOpenCategories}
                onCommit={commit}
                onNewProfile={() => setDialog("profile")}
                onView={setViewId}
                onPresets={() => setDialog("presets")}
                onJump={jump}
              />
            )}
            {destination === "layout" && (
              <LayoutEditor
                project={project}
                layout={layout}
                openCategories={openCategories}
                onOpenCategories={setOpenCategories}
                onCommit={commit}
                onTransfer={(category) => {
                  setTransferCategory(category.id);
                  setDialog("transfer");
                }}
                onEditProfile={editProfile}
                onJump={jump}
              />
            )}
            {destination === "selection" && (
              <SelectionPlaceholder layout={layout} onLayout={() => setDestination("layout")} />
            )}
          </main>
          <ScorePreview
            project={project}
            layout={layout}
            editingLabel={scopeLabel(project, editing)}
            onView={setViewId}
          />
        </div>
        <div className={styles.srOnly} role="status">
          {status}
        </div>
        {dialog === "presets" && (
          <StylePresets project={project} modified={modified} onClose={() => setDialog(null)} onCommit={commit} />
        )}
        {dialog === "profile" && (
          <NewProfileDialog
            project={project}
            sourceId={styleScope.kind === "profile" ? styleScope.id : layout.profileId}
            onClose={() => setDialog(null)}
            onCreate={(next, id, message) => {
              commit(next, message);
              editProfile(id);
            }}
          />
        )}
        {dialog === "transfer" && (
          <TransferSettings
            project={project}
            source={layout}
            category={transferCategory}
            onClose={() => setDialog(null)}
            onCommit={commit}
          />
        )}
        {dialog === "overrides" && (
          <OverridesReview
            project={project}
            onClose={() => setDialog(null)}
            onCommit={commit}
            onInspect={(id, category) => {
              setViewId(id);
              setOpenCategories((current) => ({ ...current, [category]: true }));
              setDestination("layout");
            }}
          />
        )}
      </div>
    </TooltipPrimitives.Provider>
  );
}
