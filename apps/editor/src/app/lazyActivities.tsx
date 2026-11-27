import { Component, lazy, Suspense, type ReactNode } from "react";
import { Button } from "@viritura/ui";
import { activityLoaders as loaders } from "./activityLoaders";
import styles from "./lazyActivities.module.css";

export const LazyPlayView = lazy(loaders.play);
export const LazyClickView = lazy(loaders.click);
export const LazyRollView = lazy(loaders.roll);
export const LazyPictureView = lazy(loaders.picture);
export const LazyReviewView = lazy(loaders.review);

interface LoadBoundaryState {
  readonly failed: boolean;
}

class ActivityLoadBoundary extends Component<
  { readonly label: string; readonly children: ReactNode },
  LoadBoundaryState
> {
  override state: LoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): LoadBoundaryState {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className={styles.message}>
        <p>{this.props.label} could not be loaded.</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}

/** Suspense + load-failure boundary for one lazily loaded activity. */
export function LazyActivity({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <ActivityLoadBoundary label={label}>
      <Suspense
        fallback={
          <div role="status" className={styles.message}>
            Loading {label}…
          </div>
        }
      >
        {children}
      </Suspense>
    </ActivityLoadBoundary>
  );
}
