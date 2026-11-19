import type { DocumentStore } from "../store/documentStore";
import { useMcpSessionStore, type McpProposal } from "./sessionStore";
import { getDocumentIdentity, patchesStillApplicable } from "./patchRevisions";

export function isMcpProposalCurrent(documentStore: DocumentStore, proposal: McpProposal): boolean {
  const state = documentStore.getState();
  if (state.scoreRevision === proposal.originalRevision) return true;
  if (proposal.document || proposal.repairMnx || !proposal.patchBase || !state.workingScore) return false;
  return patchesStillApplicable(
    proposal.patchBase,
    state.workingScore,
    getDocumentIdentity(documentStore),
    proposal.patches,
  );
}

export function acceptMcpProposal(documentStore: DocumentStore, proposal: McpProposal): void {
  try {
    if (!isMcpProposalCurrent(documentStore, proposal)) {
      throw new Error("The score changed after this proposal was created. Ask the MCP client to propose it again.");
    }
    if (proposal.document) {
      documentStore.getState().commitDocument(proposal.document.proposedMnx);
    } else if (proposal.repairMnx) {
      documentStore.getState().commitDocument(proposal.repairMnx);
    } else {
      documentStore.getState().commitPatches(structuredClone(proposal.patches));
    }
    useMcpSessionStore.getState().setProposalStatus(proposal.id, "accepted");
  } catch (error) {
    useMcpSessionStore.getState().setProposalStatus(proposal.id, "stale");
    throw error;
  }
}
