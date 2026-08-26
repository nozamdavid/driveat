import { useEffect, useRef, useState } from "react";

export const DEFAULT_VIEWPORT_MARGIN = "400px 0px";

export type UseInViewOptions = Readonly<{
  disabled?: boolean | undefined;
  rootMargin?: string | undefined;
}>;

export function observeElementInView(
  element: Element,
  onInView: () => void,
  options: { rootMargin?: string | undefined } = {},
): () => void {
  if (typeof window === "undefined" || typeof window.IntersectionObserver === "undefined") {
    onInView();
    return () => {};
  }

  const observer = new window.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          onInView();
          observer.disconnect();
          break;
        }
      }
    },
    {
      rootMargin: options.rootMargin ?? DEFAULT_VIEWPORT_MARGIN,
    },
  );

  observer.observe(element);
  return () => observer.disconnect();
}

export function useInView(
  options: UseInViewOptions = {},
): readonly [React.RefObject<HTMLDivElement | null>, boolean] {
  const [inView, setInView] = useState(false);
  const targetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (options.disabled || inView) return;
    const element = targetRef.current;
    if (!element) return;

    return observeElementInView(element, () => setInView(true), {
      rootMargin: options.rootMargin,
    });
  }, [inView, options.disabled, options.rootMargin]);

  return [targetRef, inView] as const;
}
