import type { BeforeMount } from "@viritura/monaco-react";
import { configureMnxDiagnostics } from "../../mnx-schema";

export const PLAYGROUND_MODEL_PATH = "file:///playground.mnx";

export const configurePlaygroundEditor: BeforeMount = (monaco) => {
  configureMnxDiagnostics(monaco);
};
