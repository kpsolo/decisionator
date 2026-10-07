import { useCallback, useEffect, useMemo, useRef } from "react";
import { ExposureTracker } from "./exposure-tracker.js";

const TICK_MS = 250;
const FLUSH_MS = 1000;

/**
 * Browser adapter for {@link ExposureTracker}: one shared IntersectionObserver for every element
 * showing an option, page visibility and window focus as pause signals, and batched reports at
 * most once a second per plugin. Several elements may show the same option (a card and its
 * detail view); the option is on screen while any of them is.
 */
export function useExposure(
  watchers: { id: string; ms: number }[],
  onExposed: (pluginId: string, optionIds: string[]) => void
): (optionId: string) => (el: Element | null) => void {
  const trackers = useRef(new Map<string, ExposureTracker>());
  const onExposedRef = useRef(onExposed);
  onExposedRef.current = onExposed;

  // Per element state, aggregated per option id.
  const elementOption = useRef(new Map<Element, string>());
  const elementState = useRef(new Map<Element, { ratio: number; visible: number }>());
  const observer = useRef<IntersectionObserver | null>(null);
  const enabled = watchers.length > 0;

  const feed = useCallback((optionId: string, now: number) => {
    let best = { ratio: 0, visible: 0 };
    for (const [el, id] of elementOption.current) {
      if (id !== optionId) continue;
      const s = elementState.current.get(el);
      if (s && (s.ratio > best.ratio || s.visible > best.visible)) best = s;
    }
    const viewport = typeof window === "undefined" ? 0 : window.innerHeight;
    for (const t of trackers.current.values())
      t.observe(optionId, best.ratio, best.visible, viewport, now);
  }, []);

  // Keep one tracker per watching plugin, with its current threshold.
  useEffect(() => {
    const next = new Map<string, ExposureTracker>();
    for (const w of watchers) {
      const t = trackers.current.get(w.id) ?? new ExposureTracker(w.ms);
      t.setMinMs(w.ms);
      next.set(w.id, t);
    }
    const added = [...next.keys()].some((id) => !trackers.current.has(id));
    trackers.current = next;
    if (added) {
      const now = performance.now();
      for (const id of new Set(elementOption.current.values())) feed(id, now);
    }
  }, [watchers, feed]);

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const now = performance.now();
        const touched = new Set<string>();
        for (const e of entries) {
          const id = elementOption.current.get(e.target);
          if (!id) continue;
          elementState.current.set(e.target, {
            ratio: e.isIntersecting ? e.intersectionRatio : 0,
            visible: e.isIntersecting ? e.intersectionRect.height : 0,
          });
          touched.add(id);
        }
        for (const id of touched) feed(id, now);
      },
      { root: null, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    observer.current = io;
    for (const el of elementOption.current.keys()) io.observe(el);

    const visibility = () => {
      const visible = document.visibilityState === "visible" && document.hasFocus();
      const now = performance.now();
      for (const t of trackers.current.values()) t.setPageVisible(visible, now);
    };
    const onFocus = () => visibility();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", onFocus);
    window.addEventListener("focus", onFocus);
    visibility();

    const lastFlush = new Map<string, number>();
    const ready = new Map<string, string[]>();
    const timer = window.setInterval(() => {
      const now = performance.now();
      for (const [pluginId, t] of trackers.current) {
        const ids = t.tick(now);
        if (ids.length > 0) ready.set(pluginId, [...(ready.get(pluginId) ?? []), ...ids]);
        const queued = ready.get(pluginId);
        if (queued && queued.length > 0 && now - (lastFlush.get(pluginId) ?? 0) >= FLUSH_MS) {
          ready.delete(pluginId);
          lastFlush.set(pluginId, now);
          onExposedRef.current(pluginId, queued);
        }
      }
    }, TICK_MS);

    return () => {
      io.disconnect();
      observer.current = null;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, feed]);

  // Each call returns a ref callback for one element; callers memoise it (useExposureRef).
  return useMemo(
    () => (optionId: string) => {
      let current: Element | null = null;
      return (el: Element | null) => {
        if (current === el) return;
        if (current) {
          observer.current?.unobserve(current);
          elementOption.current.delete(current);
          elementState.current.delete(current);
          feed(optionId, performance.now());
        }
        current = el;
        if (el) {
          elementOption.current.set(el, optionId);
          observer.current?.observe(el);
        }
      };
    },
    [feed]
  );
}
