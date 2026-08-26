import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_VIEWPORT_MARGIN, observeElementInView } from "./use-in-view";

describe("observeElementInView", () => {
  let callbacks: Array<(entries: IntersectionObserverEntry[]) => void> = [];
  let observedElements: Element[] = [];
  let disconnectCalled = false;
  let passedOptions: IntersectionObserverInit | undefined;

  beforeEach(() => {
    callbacks = [];
    observedElements = [];
    disconnectCalled = false;
    passedOptions = undefined;

    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null = null;
      readonly rootMargin: string;
      readonly scrollMargin: string = "";
      readonly thresholds: readonly number[] = [];

      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        passedOptions = options;
        this.rootMargin = options?.rootMargin ?? "";
        callbacks.push(callback as (entries: IntersectionObserverEntry[]) => void);
      }

      observe(target: Element): void {
        observedElements.push(target);
      }

      unobserve(target: Element): void {
        observedElements = observedElements.filter((el) => el !== target);
      }

      disconnect(): void {
        disconnectCalled = true;
      }

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.stubGlobal("window", { IntersectionObserver: MockIntersectionObserver });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("configures observer with default pixel margin and observes target element", () => {
    const mockElement = {} as Element;
    const onInView = vi.fn();

    const cleanup = observeElementInView(mockElement, onInView);

    expect(passedOptions?.rootMargin).toBe(DEFAULT_VIEWPORT_MARGIN);
    expect(observedElements).toContain(mockElement);
    expect(onInView).not.toHaveBeenCalled();

    cleanup();
    expect(disconnectCalled).toBe(true);
  });

  it("triggers callback when target enters viewport span and disconnects", () => {
    const mockElement = {} as Element;
    const onInView = vi.fn();

    observeElementInView(mockElement, onInView);

    callbacks.forEach((cb) =>
      cb([
        {
          isIntersecting: true,
          target: mockElement,
        } as IntersectionObserverEntry,
      ]),
    );

    expect(onInView).toHaveBeenCalledTimes(1);
    expect(disconnectCalled).toBe(true);
  });

  it("supports custom rootMargin pixel spans", () => {
    const mockElement = {} as Element;
    const onInView = vi.fn();

    observeElementInView(mockElement, onInView, { rootMargin: "600px 0px" });

    expect(passedOptions?.rootMargin).toBe("600px 0px");
  });

  it("immediately triggers callback when IntersectionObserver is not available", () => {
    vi.stubGlobal("window", {});
    const mockElement = {} as Element;
    const onInView = vi.fn();

    observeElementInView(mockElement, onInView);

    expect(onInView).toHaveBeenCalledTimes(1);
  });
});
