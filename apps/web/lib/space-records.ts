import type { Agent } from "@atproto/api";

import type { RawSpaceRecord } from "./private-library";

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 100;

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
  maxPages?: number;
  pageLimitMessage?: string;
  /**
   * Called after each fetched page; return false to stop paging early
   * without discarding records already parsed from the current page.
   */
  onPage?: (records: SpaceRecordPage) => boolean;
}>;

export async function listAllSpaceRecords(
  agent: Agent,
  target: SpaceRecordsTarget,
  options?: ListAllSpaceRecordsOptions,
): Promise<readonly RawSpaceRecord[]> {
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const onPage = options?.onPage;
  const records: RawSpaceRecord[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await agent.com.atproto.space.listRecords({
      space: target.space,
      repo: target.repo,
      collection: target.collection,
      limit: PAGE_SIZE,
      reverse: true,
      ...(cursor ? { cursor } : {}),
    });
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
