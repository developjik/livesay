/**
 * React binding. One hook, no context, no provider — the announcer is a mutable
 * object that must outlive renders, which is exactly what a ref is for.
 *
 *   const say = useStreamingAnnouncer();
 *   for await (const delta of stream) say.push(delta);
 *   say.done();
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  createStreamingAnnouncer,
  type AnnouncerState,
  type StreamingAnnouncer,
  type StreamingAnnouncerOptions,
} from './core.js';

export interface StreamingAnnouncerApi {
  push(delta: string): void;
  done(): void;
  abort(reason?: string): void;
  error(message: string): void;
  status(text: string): void;
  /** Start a new answer without remounting. */
  reset(): void;
  state(): AnnouncerState;
}

export function useStreamingAnnouncer(options: StreamingAnnouncerOptions = {}): StreamingAnnouncerApi {
  const optionsRef = useRef(options);
  const announcerRef = useRef<StreamingAnnouncer | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  });

  const get = useCallback((): StreamingAnnouncer => {
    if (!announcerRef.current) {
      announcerRef.current = createStreamingAnnouncer(optionsRef.current);
    }
    return announcerRef.current;
  }, []);

  useEffect(
    () => () => {
      announcerRef.current?.dispose();
      announcerRef.current = null;
    },
    [],
  );

  return useMemo<StreamingAnnouncerApi>(
    () => ({
      push: (delta: string) => get().push(delta),
      done: () => get().done(),
      abort: (reason?: string) => get().abort(reason),
      error: (message: string) => get().error(message),
      status: (text: string) => get().status(text),
      reset: () => get().reset(),
      state: () => get().state,
    }),
    [get],
  );
}

export default useStreamingAnnouncer;
