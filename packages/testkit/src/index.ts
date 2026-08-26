export function fixedClock(instant: string): () => Date {
  const timestamp = new Date(instant);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TypeError("A fixed test clock requires a valid ISO timestamp.");
  }
  return () => new Date(timestamp);
}

