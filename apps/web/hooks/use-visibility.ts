'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Shared IntersectionObserver for tracking element visibility.
 * Uses a single observer instance for all elements to reduce overhead.
 */
const MARGIN = '800px';
let sharedObserver: IntersectionObserver | null = null;
const callbacks = new Map<Element, (visible: boolean) => void>();

function getSharedObserver(): IntersectionObserver {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = callbacks.get(entry.target);
          if (cb) cb(entry.isIntersecting);
        }
      },
      { rootMargin: MARGIN },
    );
  }
  return sharedObserver;
}

/**
 * Hook that tracks whether an element is near the viewport.
 * Uses a shared IntersectionObserver (one for all cards) instead of one per element.
 */
export function useVisibility<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const setVisible = useCallback((v: boolean) => setIsVisible(v), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = getSharedObserver();
    callbacks.set(el, setVisible);
    observer.observe(el);

    return () => {
      observer.unobserve(el);
      callbacks.delete(el);
    };
  }, [setVisible]);

  return [ref, isVisible];
}
