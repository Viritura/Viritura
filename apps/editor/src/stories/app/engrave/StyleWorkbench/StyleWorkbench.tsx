import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Badge, Button, ButtonGroup, Select, TooltipPrimitives } from "@viritura/ui";
import {
  findLayout,
  initialProject,
  isModifiedFromOrigin,
  scopeLabel,
  type Category,
  type Destination,
  type NavigatorMode,
  type Project,
  type Scope,
} from "./styleModel";
import { HouseStyleEditor } from "./HouseStyleEditor";
import { LayoutEditor, SelectionPlaceholder } from "./LayoutEditor";
import { LayoutNavigator } from "./LayoutNavigator";
import { HouseStyleEntry, PanelModeHeader } from "./ModeSwitch";
import type { OpenCategories } from "./CategoryBrowser";
import { ScorePreview } from "./ScorePreview";
import { NewProfileDialog, OverridesReview, StylePresets, TransferSettings } from "./StyleDialogs";
import styles from "./StyleWorkbench.module.css";

interface WorkbenchProps {
  initialNavigator?: NavigatorMode;
  initialDestination?: Destination;
}

type DialogKind = "presets" | "overrides" | "transfer" | "profile" | null;

export function StyleWorkbench({ initialNavigator = "dropdown", initialDestination = "layout" }: WorkbenchProps) {
  const [navigator, setNavigator] = useState(initialNavigator);
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
  const totalOverrides = project.layouts.reduce((count, entry) => count + Object.keys(entry.overrides).length, 0);
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
            <span>Layout switching</span>
            <ButtonGroup
              ariaLabel="Layout switching experiment"
              options={[
                { value: "list", label: "Always-visible list" },
                { value: "dropdown", label: "Top-nav dropdown" },
              ]}
              value={navigator}
              onChange={setNavigator}
            />
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
          {navigator === "dropdown" && (
            <div className={styles.switcher}>
              <Select
                aria-label="Active layout"
                value={viewId}
                options={project.layouts.map((entry) => ({ value: entry.id, label: entry.name }))}
                onValueChange={setViewId}
              />
            </div>
          )}
          <div className={styles.toolbar}>
            <HouseStyleEntry
              name={project.style.name}
              modified={modified}
              destination={destination}
              onDestination={setDestination}
            />
            <Button onClick={() => setDialog("overrides")}>{totalOverrides} overrides</Button>
            <Button ariaLabel="Undo change" tooltip="Undo change" disabled={!history.length} onClick={undo}>
              <Undo2 size={15} />
              Undo
            </Button>
          </div>
        </header>
        <div className={navigator === "list" ? styles.workspace : styles.workspaceCompact}>
          {navigator === "list" && (
            <LayoutNavigator project={project} viewId={viewId} editing={editing} onView={setViewId} />
          )}
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
            editing={editing}
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
