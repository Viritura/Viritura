import { useEffect, useEffectEvent, type RefObject } from "react";
import type { ClickEngine, ClickSound } from "@viritura/audio/click";
import { subscribeMetronomeSound } from "@viritura/playback";

export function useClickSound(
  engineRef: RefObject<ClickEngine | undefined>,
  mounted: RefObject<boolean>,
  onFailure: (message: string) => void,
): void {
  const changeSound = useEffectEvent((sound: ClickSound) => {
    const engine = engineRef.current;
    if (!engine) return;
    void engine.setSound(sound).catch((failure: unknown) => {
      if (!mounted.current || engineRef.current !== engine) return;
      engineRef.current = undefined;
      const detail = `Could not change click sound: ${failure instanceof Error ? failure.message : String(failure)}`;
      onFailure(detail);
      void engine.dispose().catch((cleanupFailure: unknown) => {
        if (mounted.current) {
          const cleanup = cleanupFailure instanceof Error ? cleanupFailure.message : String(cleanupFailure);
          onFailure(`${detail}; could not close audio: ${cleanup}`);
        }
      });
    });
  });

  useEffect(() => subscribeMetronomeSound((sound) => changeSound(sound)), []);
}
