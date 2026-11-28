import type { Score } from "@viritura/core";
import { PAGE_FIELDS, readPageLayer, resolvedPageSetup, setPageValues, type PageScope } from "../../../../engraveStyle";
import { PageFieldControl } from "./PageFieldControl";
import { pageFieldView } from "./pageFieldView";
import { StyleField } from "./StyleField";
import { useStyleNavigation } from "./styleNavigation";

interface PageFieldRowsProps {
  score: Score;
  scope: PageScope;
}

/** Page size, staff size, margins, and page turns for one profile or layout. */
export function PageFieldRows({ score, scope }: PageFieldRowsProps) {
  const nav = useStyleNavigation();
  const setup = resolvedPageSetup(score, scope);
  const storedPageTurns = readPageLayer(score, scope)?.pageTurns;
  const scopeKey = scope.kind === "layout" ? `layout-${scope.index}` : `profile-${scope.role}-${scope.id ?? "default"}`;
  return PAGE_FIELDS.map((field) => {
    const view = pageFieldView(score, scope, field, nav);
    const labelId = `style-${scopeKey}-${field.id}`;
    return (
      <StyleField key={field.id} label={field.label} labelId={labelId} {...view}>
        <PageFieldControl
          field={field}
          setup={setup}
          storedPageTurns={storedPageTurns}
          labelId={labelId}
          onChange={(values) => nav.transform((current) => setPageValues(current, scope, values))}
        />
      </StyleField>
    );
  });
}
