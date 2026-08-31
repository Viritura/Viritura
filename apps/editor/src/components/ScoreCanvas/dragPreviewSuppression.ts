import type { DisplayList } from "@viritura/renderer";

/** Remove one element's tagged ink from a transient display-list paint. */
export function suppressElementCommands(displayList: DisplayList, elementId: string): DisplayList {
  const commands: DisplayList["commands"] = [];
  const elementIds: NonNullable<DisplayList["elementIds"]> = [];
  for (let index = 0; index < displayList.commands.length; index++) {
    const commandElementId = displayList.elementIds?.[index] ?? null;
    const matches =
      commandElementId !== null &&
      (commandElementId === elementId ||
        commandElementId.startsWith(`${elementId}/`) ||
        elementId.startsWith(`${commandElementId}/`));
    if (matches) continue;
    commands.push(displayList.commands[index]!);
    elementIds.push(commandElementId);
  }
  const retainedRenderLayers = displayList.retainedRenderLayers?.map((layer) => ({
    ...layer,
    displayList: suppressElementCommands(layer.displayList, elementId),
  }));
  return {
    ...displayList,
    commands,
    elementIds,
    retainedRenderLayers,
    finalizeRetainedFrame: displayList.finalizeRetainedFrame,
  };
}
