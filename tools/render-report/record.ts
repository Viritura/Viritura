import { renameSync } from "node:fs";
import { recordingOf, recordTests, workingTree } from "./recording";

const recording = recordingOf(workingTree());
renameSync(recordTests([]), recording);
console.log(recording);
