import { create } from "zustand";
import type { ScorePatch } from "@viritura/core";
import type { StructuralDiffSummary } from "./documentSummary";
import { clearPatchBatches } from "./patchBatches";
import { clearIdempotentRequests } from "./idempotentRequests";

type McpConnectionStatus = "idle" | "registering" | "waiting" | "connected" | "error";
type McpProposalStatus = "pending" | "accepted" | "rejected" | "stale";

/** Whole-document proposal payload (from `preview.propose_mnx`). Present only on
 *  document-mode proposals, which are reviewed via a structural summary rather
 *  than a per-line diff and committed through `documentStore.commitDocument`. */
interface McpDocumentProposal {
  /** Canonical MNX JSON (validated round-trip) applied verbatim on accept. */
  readonly proposedMnx: string;
  /** Before/after/delta counts for human review of a large change. */
  readonly diff: StructuralDiffSummary;
}

export interface McpProposal {
  readonly id: string;
  readonly summary: string;
  readonly patches: readonly ScorePatch[];
  readonly originalMnx: string;
  readonly originalRevision: string;
  /** Whole-document diff payload for small scores; large scores use patch review. */
  readonly proposedMnx: string | null;
  /** Full repaired document when a repair cannot be addressed by part ID. */
  readonly repairMnx?: string;
  /** Present for whole-document proposals; drives the structural review surface. */
  readonly document?: McpDocumentProposal;
  readonly status: McpProposalStatus;
}

export interface McpRegistration {
  readonly sessionId: string;
  readonly hostToken: string;
  readonly mcpUrl: string;
  readonly hostWebSocketUrl: string;
}

interface McpSessionState {
  desired: boolean;
  autoAccept: boolean;
  status: McpConnectionStatus;
  registration: McpRegistration | null;
  clientName: string | null;
  error: string | null;
  proposals: Record<string, McpProposal>;
  start: (options?: { autoAccept?: boolean }) => void;
  stop: () => void;
  setRegistering: (clearRegistration?: boolean) => void;
  setRegistration: (registration: McpRegistration) => void;
  setReady: () => void;
  setClientConnected: (name: string | null) => void;
  setError: (message: string) => void;
  clear: () => void;
  addProposal: (proposal: McpProposal) => void;
  setProposalStatus: (id: string, status: McpProposalStatus) => void;
}

export const useMcpSessionStore = create<McpSessionState>((set) => ({
  desired: false,
  autoAccept: false,
  status: "idle",
  registration: null,
  clientName: null,
  error: null,
  proposals: {},
  start: (options) =>
    set({ desired: true, autoAccept: options?.autoAccept ?? false, status: "registering", error: null }),
  stop: () => {
    clearPatchBatches();
    clearIdempotentRequests();
    set({ desired: false, autoAccept: false });
  },
  setRegistering: (clearRegistration = false) =>
    set({ status: "registering", ...(clearRegistration ? { registration: null } : {}), clientName: null, error: null }),
  setRegistration: (registration) => set({ registration, status: "waiting", error: null }),
  setReady: () => set({ status: "waiting", error: null }),
  setClientConnected: (clientName) => set({ status: "connected", clientName, error: null }),
  setError: (error) => set({ status: "error", error }),
  clear: () => {
    clearPatchBatches();
    clearIdempotentRequests();
    set({ status: "idle", registration: null, clientName: null, error: null, proposals: {} });
  },
  addProposal: (proposal) => set((state) => ({ proposals: { ...state.proposals, [proposal.id]: proposal } })),
  setProposalStatus: (id, status) =>
    set((state) => {
      const proposal = state.proposals[id];
      if (!proposal) return state;
      return { proposals: { ...state.proposals, [id]: { ...proposal, status } } };
    }),
}));
