import { useState } from "react";
import { BookOpen, Undo2 } from "lucide-react";
import { Badge, Button, ButtonGroup, Tabs, TooltipPrimitives } from "@viritura/ui";
import {
  DESTINATIONS,
  initialProject,
  PRESETS,
  type Category,
  type Destination,
  type Navigation,
  type Project,
  type Scope,
  type StylePreset,
} from "./styleModel";
import { ScorePreview } from "./ScorePreview";
import { OverridesReview, StyleLibrary, TransferSettings } from "./StyleDialogs";
import { SettingsEditor, SelectionPlaceholder } from "./SettingsEditor";
import { WorkbenchNavigation } from "./WorkbenchNavigation";
import styles from "./StyleWorkbench.module.css";

export function StyleWorkbench({ initialNavigation = "tabs" }: { initialNavigation?: Navigation }) {
  const [navigation, setNavigation] = useState(initialNavigation);
  const [project, setProject] = useState(initialProject);
  const [history, setHistory] = useState<Project[]>([]);
  const [presets, setPresets] = useState<StylePreset[]>(PRESETS);
  const [layoutId, setLayoutId] = useState("full");
  const [destination, setDestination] = useState<Destination>("project");
  const [projectScope, setProjectScope] = useState<Exclude<Scope, "layout">>("score");
  const [categoryId, setCategoryId] = useState<Category>("numbers");
  const [dialog, setDialog] = useState<"library" | "overrides" | "transfer" | null>(null);
  const [status, setStatus] = useState("Ready. Try changing a default, then inspect Cello's protected overrides.");
  const layout = project.layouts.find((entry) => entry.id === layoutId)!;
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
    setStatus("Undid the last project change.");
  }
  return (
    <TooltipPrimitives.Provider>
      <div className={styles.root}>
        <PrototypeHeader
          navigation={navigation}
          onNavigation={setNavigation}
          onReset={() => {
            setProject(initialProject());
            setHistory([]);
            setPresets(PRESETS);
            setStatus("Reset all mock data.");
          }}
        />
        <header className={styles.projectBar}>
          <div>
            <h1>Evening Sketches</h1>
            <p>Engrave / 1 score, 2 parts</p>
          </div>
          <div className={styles.toolbar}>
            <Button onClick={() => setDialog("library")}>
              <BookOpen size={15} />
              House-style library
            </Button>
            <Button onClick={() => setDialog("overrides")}>{totalOverrides} layout overrides</Button>
            <Button
              ariaLabel="Undo project change"
              tooltip="Undo project change"
              disabled={!history.length}
              onClick={undo}
            >
              <Undo2 size={15} />
              Undo
            </Button>
          </div>
        </header>
        <div className={styles.workspace}>
          <WorkbenchNavigation
            navigation={navigation}
            project={project}
            layoutId={layoutId}
            destination={destination}
            categoryId={categoryId}
            onDestination={setDestination}
            onLayout={setLayoutId}
            onCategory={setCategoryId}
          />
          <main className={styles.editor}>
            {navigation === "tabs" && (
              <Tabs
                tabs={DESTINATIONS}
                activeTab={destination}
                onTabChange={(id) => {
                  const entry = DESTINATIONS.find((item) => item.id === id);
                  if (entry) setDestination(entry.id);
                }}
              />
            )}
            {destination === "selection" ? (
              <SelectionPlaceholder layout={layout} onLayout={() => setDestination("layout")} />
            ) : (
              <SettingsEditor
                project={project}
                layout={layout}
                scope={destination === "project" ? projectScope : "layout"}
                categoryId={categoryId}
                onScope={setProjectScope}
                onLayout={() => setDestination("layout")}
                onTransfer={() => setDialog("transfer")}
                onCommit={commit}
              />
            )}
          </main>
          <ScorePreview project={project} layout={layout} />
        </div>
        <footer className={styles.status} role="status">
          {status}
          <span>Local mock data only / refresh to reset</span>
        </footer>
        {dialog === "library" && (
          <StyleLibrary
            project={project}
            presets={presets}
            onClose={() => setDialog(null)}
            onCommit={commit}
            onSave={(preset) => {
              setPresets((current) => [...current, preset]);
              setStatus(`Saved ${preset.name} to the mock library.`);
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
              setLayoutId(id);
              setCategoryId(category);
              setDestination("layout");
            }}
          />
        )}
      </div>
    </TooltipPrimitives.Provider>
  );
}

function PrototypeHeader({
  navigation,
  onNavigation,
  onReset,
}: {
  navigation: Navigation;
  onNavigation: (navigation: Navigation) => void;
  onReset: () => void;
}) {
  return (
    <header className={styles.prototypeBar}>
      <div>
        <Badge variant="warning">Design sandbox</Badge>
        <strong>Engrave / Style workbench</strong>
      </div>
      <div className={styles.toolbar}>
        <span>Navigation experiment</span>
        <ButtonGroup
          options={[
            { value: "tabs", label: "Destination tabs" },
            { value: "scope-first", label: "Scope first" },
          ]}
          value={navigation}
          onChange={onNavigation}
        />
        <Button size="sm" onClick={onReset}>
          Reset demo
        </Button>
      </div>
    </header>
  );
}
