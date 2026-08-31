import { useCallback } from "react";
import { toast } from "sonner";
import { DiffPreviewModal } from "../components/DiffPreviewModal";
import { useDocumentStoreApi } from "../store/DocumentContext";
import { useMcpSessionStore } from "./sessionStore";
import { McpDocumentReviewDialog } from "./McpDocumentReviewDialog";
import { McpPatchReviewDialog } from "./McpPatchReviewDialog";

/** Displays the oldest pending MCP patch proposal and commits it only after approval. */
export function McpProposalReview() {
  const documentStore = useDocumentStoreApi();
  const proposals = useMcpSessionStore((state) => state.proposals);
  const proposal = Object.values(proposals).find((candidate) => candidate.status === "pending");

  const reject = useCallback(() => {
    if (!proposal) return;
    useMcpSessionStore.getState().setProposalStatus(proposal.id, "rejected");
    toast.info("MCP proposal rejected");
  }, [proposal]);

  const accept = useCallback(() => {
    if (!proposal) return;
    const currentMnx = documentStore.getState().mnxJson;
    if (currentMnx !== proposal.originalMnx) {
      useMcpSessionStore.getState().setProposalStatus(proposal.id, "stale");
      toast.error("The score changed after this proposal was created. Ask the MCP client to propose it again.");
      return;
    }

    try {
      if (proposal.document) {
        documentStore.getState().commitDocument(proposal.document.proposedMnx);
      } else {
        documentStore.getState().commitPatches(proposal.patches);
      }
      useMcpSessionStore.getState().setProposalStatus(proposal.id, "accepted");
      toast.success("MCP proposal applied");
    } catch (error) {
      useMcpSessionStore.getState().setProposalStatus(proposal.id, "stale");
      toast.error(error instanceof Error ? error.message : "The proposal could not be applied.");
    }
  }, [documentStore, proposal]);

  if (!proposal) return null;
  if (proposal.document) {
    return <McpDocumentReviewDialog proposal={proposal} onAccept={accept} onReject={reject} />;
  }
  if (proposal.proposedMnx === null) {
    return <McpPatchReviewDialog proposal={proposal} onAccept={accept} onReject={reject} />;
  }
  return (
    <DiffPreviewModal
      originalMnx={prettyJson(proposal.originalMnx)}
      proposedMnx={proposal.proposedMnx}
      onAccept={accept}
      onReject={reject}
    />
  );
}

function prettyJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
