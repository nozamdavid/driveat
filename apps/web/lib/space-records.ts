import type { Agent } from "@atproto/api";

import type { RawSpaceRecord } from "./private-library";

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 100;
export const DEFAULT_LIST_RECORDS_DELAY_MS = 1000;

export type SpaceRecordsTarget = Readonly<{
  collection: string;
  repo: string;
  space: string;
}>;

export type SpaceRecordPage = readonly Readonly<{
  cid: string;
  collection: string;
  rkey: string;
  value?: Readonly<{ [key: string]: unknown }>;
}>[];

export type ListAllSpaceRecordsOptions = Readonly<{
  delayMs?: number;
  maxPages?: number;
  pageLimitMessage?: string;
  /**
   * Called after each fetched page; return false to stop paging early
   * without discarding records already parsed from the current page.
   */
  onPage?: (records: SpaceRecordPage) => boolean;
}>;

let lastListRecordsTime = 0;
let requestQueue: Promise<void> = Promise.resolve();

/**
 * Paces listRecords requests across the application so that at least
 * `minSpacingMs` (default 1,000ms) elapses between consecutive API calls.
 */
export function paceListRecordsRequest<T>(
  requestFn: () => Promise<T>,
  minSpacingMs = DEFAULT_LIST_RECORDS_DELAY_MS,
): Promise<T> {
  if (minSpacingMs <= 0) {
    return requestFn();
  }

  const run = async () => {
    const now = Date.now();
    const elapsed = now - lastListRecordsTime;
    if (elapsed < minSpacingMs && lastListRecordsTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, minSpacingMs - elapsed));
    }
    try {
      return await requestFn();
    } finally {
      lastListRecordsTime = Date.now();
    }
  };

  const next = requestQueue.then(run, run);
  requestQueue = next.then(
    () => {},
    () => {},
  );
  return next;
}

export function resetListRecordsPacing(): void {
  lastListRecordsTime = 0;
  requestQueue = Promise.resolve();
}

export async function listAllSpaceRecords(
  agent: Agent,
  target: SpaceRecordsTarget,
  options?: ListAllSpaceRecordsOptions,
): Promise<readonly RawSpaceRecord[]> {
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const delayMs = options?.delayMs ?? DEFAULT_LIST_RECORDS_DELAY_MS;
  const onPage = options?.onPage;
  const records: RawSpaceRecord[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await paceListRecordsRequest(
      () =>
        agent.com.atproto.space.listRecords({
          space: target.space,
          repo: target.repo,
          collection: target.collection,
          limit: PAGE_SIZE,
          reverse: true,
          ...(cursor ? { cursor } : {}),
        }),
      delayMs,
    );
    for (const record of response.data.records) {
      if (!record.value) continue;
      records.push({
        uri: `${target.space}/${target.repo}/${record.collection}/${record.rkey}`,
        cid: record.cid,
        value: record.value,
      });
    }
    if (onPage && !onPage(response.data.records)) return records;
    cursor = response.data.cursor;
    if (!cursor) return records;
  }
  throw new Error(
    options?.pageLimitMessage ??
      `Collection ${target.collection} exceeded the ${maxPages}-page Space safety limit.`,
  );
}
