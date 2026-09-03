import coverageMarkdown from "../../../../../docs/spec/music-notationref-coverage.md?raw";
import { parseCoverageMarkdown } from "./parseCoverageMarkdown";

export const coverageAudit = parseCoverageMarkdown(coverageMarkdown);
