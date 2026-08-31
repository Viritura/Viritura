export { type CommitInfo, type ProjectAdapter, type ProjectStatus } from "./ProjectAdapter";

export { StandaloneProjectAdapter } from "./StandaloneProjectAdapter";
export { GitProjectAdapter, initRepo, openRepo } from "./GitProjectAdapter";

export { synthesizeCommitMessage } from "./commitMessage";
