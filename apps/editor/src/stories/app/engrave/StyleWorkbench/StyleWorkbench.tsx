import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Badge, Button, ButtonGroup, Select, Tabs, TooltipPrimitives } from "@viritura/ui";
import {
  DESTINATIONS,
  findLayout,
  initialProject,
  isModifiedFromOrigin,
  PRESETS,
  scopeLabel,
  type Category,
  type Destination,
  type HouseStyle,
  type NavigatorMode,
  type Project,
  type Scope,
} from "./styleModel";
import { HouseStyleEditor } from "./HouseStyleEditor";
import { LayoutEditor, SelectionPlaceholder } from "./LayoutEditor";
import { LayoutNavigator } from "./LayoutNavigator";
import { ScorePreview } from "./ScorePreview";
import { NewProfileDialog, OverridesReview, StyleLibrary, TransferSettings } from "./StyleDialogs";
import styles from "./StyleWorkbench.module.css";

interface WorkbenchProps {
  initialNavigator?: NavigatorMode;
  initialDestination?: Destination;
}

type DialogKind = "library" | "overrides" | "transfer" | "profile" | null;

export function StyleWorkbench({ initialNavigator = "list", initialDestination = "house" }: WorkbenchProps) {
  const [navigator, setNavigator] = useState(initialNavigator);
  const [project, setProject] = useState(initialProject);
  const [history, setHistory] = useState<Project[]>([]);
  const [library, setLibrary] = useState<HouseStyle[]>(PRESETS);
  const [viewId, setViewId] = useState("violin");
  const [destination, setDestination] = useState<Destination>(initialDestination);
  const [requestedScope, setStyleScope] = useState<Scope>({ kind: "profile", id: "part" });
  const [categoryId, setCategoryId] = useState<Category>("page");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [status, setStatus] = useState("");
  const layout = findLayout(project, viewId);
  const styleScope: Scope =
    requestedScope.kind === "profile" && !project.style.profiles.some((entry) => entry.id === requestedScope.id)
      ? { kind: "common" }
      : requestedScope;
  const editing: Scope = destination === "house" ? styleScope : { kind: "layout", id: layout.id };
  const modified = isModifiedFromOrigin(project, library);
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
                setLibrary(PRESETS);
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
            <Tabs
              tabs={DESTINATIONS}
              activeTab={destination}
              onTabChange={(id) => {
                const entry = DESTINATIONS.find((item) => item.id === id);
                if (entry) setDestination(entry.id);
              }}
            />
            {destination === "house" && (
              <HouseStyleEditor
                project={project}
                scope={styleScope}
                modified={modified}
                viewing={layout}
                categoryId={categoryId}
                onScope={setStyleScope}
                onCategory={setCategoryId}
                onCommit={commit}
                onNewProfile={() => setDialog("profile")}
                onView={setViewId}
                onLibrary={() => setDialog("library")}
              />
            )}
            {destination === "layout" && (
              <LayoutEditor
                project={project}
                layout={layout}
                categoryId={categoryId}
                onCategory={setCategoryId}
                onCommit={commit}
                onTransfer={() => setDialog("transfer")}
                onEditProfile={editProfile}
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
        {dialog === "library" && (
          <StyleLibrary
            project={project}
            library={library}
            modified={modified}
            onClose={() => setDialog(null)}
            onCommit={commit}
            onSave={(style) => setLibrary((current) => [...current, style])}
          />
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
            category={categoryId}
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
              setCategoryId(category);
              setDestination("layout");
            }}
          />
        )}
      </div>
    </TooltipPrimitives.Provider>
  );
}
