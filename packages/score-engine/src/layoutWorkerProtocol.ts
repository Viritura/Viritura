import type { LayoutArgs } from "./layoutRequest";

export type LayoutWorkerCommand =
  { readonly type: "init"; readonly assetBaseUrl: string } | { readonly type: "layout"; readonly args: LayoutArgs };

export type LayoutWorkerRequest = LayoutWorkerCommand & { readonly id: number };

export type LayoutWorkerResponse =
  | { readonly id: number; readonly ok: true; readonly data?: Float32Array }
  | { readonly id: number; readonly ok: false; readonly kind: "load" | "layout"; readonly message: string };
