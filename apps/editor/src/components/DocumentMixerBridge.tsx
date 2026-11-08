import { useDocumentStore } from "../store/DocumentContext";
import { useMixerDocumentSync } from "../store/mixerPersistence";
import { MixerSyncBridge } from "./MixerSyncBridge";

export function DocumentMixerBridge() {
  useMixerDocumentSync();
  const score = useDocumentStore((state) => state.workingScore);
  return <MixerSyncBridge score={score} />;
}
