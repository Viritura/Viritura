import { NavList } from "@viritura/ui";
import { playgroundCatalogGroups } from "./playgroundCatalog";

interface PlaygroundExampleBrowserProps {
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly mobileActive: boolean;
}

export function PlaygroundExampleBrowser({ value, onChange, mobileActive }: PlaygroundExampleBrowserProps) {
  return (
    <aside className="mnx-playground__browser" data-mobile-active={mobileActive} aria-label="MNX examples">
      <div className="mnx-playground__browser-heading">
        <span>Examples</span>
        <a href="https://mnx.formats.music/docs/mnx-reference/examples/" target="_blank" rel="noreferrer">
          W3C reference
        </a>
      </div>
      <NavList
        groups={playgroundCatalogGroups}
        value={value}
        onChange={onChange}
        ariaLabel="MNX example documents"
        className="mnx-playground__example-list"
      />
    </aside>
  );
}
