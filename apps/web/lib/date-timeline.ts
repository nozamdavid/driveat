export function timelinePosition(index: number, count: number): number {
  if (count <= 1) return 0;
  return (Math.min(Math.max(index, 0), count - 1) / (count - 1)) * 100;
}

export function timelineIndexAtPosition(position: number, count: number): number {
  if (count <= 1) return 0;
  return Math.round(Math.min(Math.max(position, 0), 1) * (count - 1));
}

export function clampTimelineIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

export function timelineYearLabel(key: string, previousKey?: string): string | undefined {
  const year = /^\d{4}/u.exec(key)?.[0];
  if (!year) return previousKey && !/^\d{4}/u.test(previousKey) ? undefined : "Unknown";
  return /^\d{4}/u.exec(previousKey ?? "")?.[0] === year ? undefined : year;
}

export function timelineUsesMonthLabels(keys: readonly string[]): boolean {
  return new Set(keys.flatMap((key) => /^\d{4}/u.exec(key)?.[0] ?? [])).size === 1;
}

export function timelineMonthLabel(key: string, previousKey?: string): string | undefined {
  const match = /^(\d{4})-(\d{2})/u.exec(key);
  if (!match) return previousKey && !/^\d{4}-\d{2}/u.test(previousKey) ? undefined : "Unknown";
  const period = `${match[1]}-${match[2]}`;
  if (/^\d{4}-\d{2}/u.exec(previousKey ?? "")?.[0] === period) return undefined;
  return new Intl.DateTimeFormat("en", { month: "short" }).format(
    new Date(2000, Number(match[2]) - 1, 1),
  );
}

export function sparseTimelineIndexes(
  count: number,
  requiredIndexes: readonly number[],
  maximum = 18,
): readonly number[] {
  if (count <= 0) return [];
  const indexes = new Set(requiredIndexes.map((index) => clampTimelineIndex(index, count)));
  indexes.add(0);
  indexes.add(count - 1);
  const sampleCount = Math.max(0, maximum - indexes.size);
  for (let sample = 1; sample <= sampleCount; sample += 1) {
    indexes.add(Math.round((sample / (sampleCount + 1)) * (count - 1)));
  }
  return Array.from(indexes).sort((left, right) => left - right);
}
