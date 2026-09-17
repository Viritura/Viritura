import { useEffect, useRef } from "react";
import { loadSoundfont, type SoundfontLoader } from "./soundfont";

export function useSoundfontBuffer(loader?: SoundfontLoader) {
  const sf2BufferRef = useRef<ArrayBuffer | null>(null);
  const sf2FetchPromiseRef = useRef<Promise<ArrayBuffer | null> | null>(null);
  const requestRef = useRef<{
    loader: SoundfontLoader | undefined;
    promise: Promise<ArrayBuffer | null>;
  } | null>(null);

  useEffect(() => {
    // Keep the in-flight request through StrictMode's effect replay and audio-mode switches.
    if (!requestRef.current || requestRef.current.loader !== loader) {
      sf2BufferRef.current = null;
      requestRef.current = { loader, promise: loadSoundfont(loader) };
    }
    const { promise } = requestRef.current;
    sf2FetchPromiseRef.current = promise;
    let active = true;
    void promise.then((buffer) => {
      if (active) sf2BufferRef.current = buffer;
    });
    return () => {
      active = false;
    };
  }, [loader]);

  return { sf2BufferRef, sf2FetchPromiseRef };
}
