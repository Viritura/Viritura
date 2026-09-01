import { TooltipPrimitives } from "@viritura/ui";
import type { PropsWithChildren } from "react";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <TooltipPrimitives.Provider delayDuration={400} skipDelayDuration={100}>
      {children}
    </TooltipPrimitives.Provider>
  );
}
