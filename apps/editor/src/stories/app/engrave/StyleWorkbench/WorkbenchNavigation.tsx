import { Badge, Button } from "@viritura/ui";
import { CATEGORIES, DESTINATIONS, type Category, type Destination, type Navigation, type Project } from "./styleModel";
import styles from "./StyleWorkbench.module.css";

interface NavigationProps {
  navigation: Navigation;
  project: Project;
  layoutId: string;
  destination: Destination;
  categoryId: Category;
  onDestination: (destination: Destination) => void;
  onLayout: (id: string) => void;
  onCategory: (category: Category) => void;
}

export function WorkbenchNavigation({
  navigation,
  project,
  layoutId,
  destination,
  categoryId,
  onDestination,
  onLayout,
  onCategory,
}: NavigationProps) {
  return (
    <nav className={styles.rail} aria-label="Engraving navigation">
      {navigation === "scope-first" && (
        <section className={styles.railSection}>
          <span className={styles.eyebrow}>Edit scope</span>
          {DESTINATIONS.map((entry) => (
            <Button
              key={entry.id}
              fullWidth
              variant="ghost"
              active={destination === entry.id}
              onClick={() => onDestination(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </section>
      )}
      <section className={styles.railSection}>
        <span className={styles.eyebrow}>Preview layout</span>
        {project.layouts.map((entry) => (
          <Button
            key={entry.id}
            fullWidth
            variant="ghost"
            active={layoutId === entry.id}
            onClick={() => onLayout(entry.id)}
            className={styles.layoutButton}
          >
            <span>
              {entry.name}
              <small>{entry.role === "score" ? "Score" : "Part"}</small>
            </span>
            <Badge variant={Object.keys(entry.overrides).length ? "warning" : "muted"}>
              {Object.keys(entry.overrides).length || "Follows style"}
            </Badge>
          </Button>
        ))}
        <p className={styles.hint}>Switching the preview does not change the Project Style editing scope.</p>
      </section>
      <section className={styles.railSection}>
        <span className={styles.eyebrow}>Categories</span>
        {CATEGORIES.map((entry) => (
          <Button
            key={entry.id}
            fullWidth
            variant="ghost"
            active={categoryId === entry.id}
            onClick={() => onCategory(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </section>
      <div className={styles.railFooter}>
        <strong>Try this</strong>
        <p>Set Parts to Hidden bar numbers. Cello keeps Every bar until you choose Use project value.</p>
      </div>
    </nav>
  );
}
