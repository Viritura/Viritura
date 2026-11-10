import type { DocumentStore } from "../store/documentStore";
import { useMcpSessionStore, type McpProposal } from "./sessionStore";

export function acceptMcpProposal(documentStore: DocumentStore, proposal: McpProposal): void {
  try {
    if (documentStore.getState().mnxJson !== proposal.originalMnx) {
      throw new Error("The score changed after this proposal was created. Ask the MCP client to propose it again.");
    }
    if (proposal.document) {
      documentStore.getState().commitDocument(proposal.document.proposedMnx);
    } else {
      documentStore.getState().commitPatches(proposal.patches);
    }
    useMcpSessionStore.getState().setProposalStatus(proposal.id, "accepted");
  } catch (error) {
    useMcpSessionStore.getState().setProposalStatus(proposal.id, "stale");
    throw error;
  }
}
