'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Shared IntersectionObservers for tracking element visibility.
 * Two zones: "near" (1600px) for preloading and "visible" (800px) for playback.
 * Uses shared observer instances (one per zone) to reduce overhead.
 */
const NEAR_MARGIN = '1600px';
const VISIBLE_MARGIN = '800px';

let nearObserver: IntersectionObserver | null = null;
let visibleObserver: IntersectionObserver | null = null;
const nearCallbacks = new Map<Element, (near: boolean) => void>();
const visibleCallbacks = new Map<Element, (visible: boolean) => void>();

function getNearObserver(): IntersectionObserver {
  if (!nearObserver) {
    nearObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = nearCallbacks.get(entry.target);
          if (cb) cb(entry.isIntersecting);
        }
      },
      { rootMargin: NEAR_MARGIN },
    );
  }
  return nearObserver;
}

function getVisibleObserver(): IntersectionObserver {
  if (!visibleObserver) {
    visibleObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = visibleCallbacks.get(entry.target);
          if (cb) cb(entry.isIntersecting);
        }
      },
      { rootMargin: VISIBLE_MARGIN },
    );
  }
  return visibleObserver;
}

/**
 * Hook that tracks element proximity to the viewport in two zones:
 * - isNear (1600px margin): element is approaching, start preloading
 * - isVisible (800px margin): element is near/in viewport, start playback
 */
export function useVisibility<T extends HTMLElement>(): [React.RefObject<T | null>, boolean, boolean] {
  const ref = useRef<T | null>(null);
  const [isNear, setIsNear] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const setNear = useCallback((v: boolean) => setIsNear(v), []);
  const setVis = useCallback((v: boolean) => setIsVisible(v), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const near = getNearObserver();
    const visible = getVisibleObserver();

    nearCallbacks.set(el, setNear);
    visibleCallbacks.set(el, setVis);
    near.observe(el);
    visible.observe(el);

    return () => {
      near.unobserve(el);
      visible.unobserve(el);
      nearCallbacks.delete(el);
      visibleCallbacks.delete(el);
    };
  }, [setNear, setVis]);

  return [ref, isVisible, isNear];
}
