/**
 * Public barrel for the WebGL2 piano-roll renderer. External consumers
 * (currently just `PianoRollCanvas.tsx`) import only what's re-exported
 * here; internal modules are private to the folder.
 */

export { PianoRollGl } from "./pianoRollGl";
export { resolveRollTheme } from "./theme";
export type { NoteColorResolver } from "./noteInstanceBuffer";
