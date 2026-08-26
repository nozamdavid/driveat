import { describe, expect, it, vi } from "vitest";

import { ensureAccountRecord, type RepoClient } from "./account-record";

describe("ensureAccountRecord", () => {
  it("does not create a record if it already exists", async () => {
    const getRecord = vi.fn().mockResolvedValue({ data: { value: { formatVersion: 1 } } });
    const putRecord = vi.fn().mockResolvedValue({});
    const client: RepoClient = { getRecord, putRecord };

    const created = await ensureAccountRecord(client, "com.example.account", "did:plc:alice");

    expect(created).toBe(false);
    expect(getRecord).toHaveBeenCalledWith({
      repo: "did:plc:alice",
      collection: "com.example.account",
      rkey: "self",
    });
    expect(putRecord).not.toHaveBeenCalled();
  });

  it("creates a self-declaration record when missing", async () => {
    const getRecord = vi.fn().mockRejectedValue(new Error("RecordNotFound"));
    const putRecord = vi.fn().mockResolvedValue({});
    const client: RepoClient = { getRecord, putRecord };

    const created = await ensureAccountRecord(
      client,
      "com.example.account",
      "did:plc:alice",
      "atgallery-test",
    );

    expect(created).toBe(true);
    expect(putRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "did:plc:alice",
        collection: "com.example.account",
        rkey: "self",
        record: expect.objectContaining({
          $type: "com.example.account",
          formatVersion: 1,
          client: "atgallery-test",
        }),
      }),
    );
  });

  it("gracefully catches write errors without throwing", async () => {
    const getRecord = vi.fn().mockRejectedValue(new Error("RecordNotFound"));
    const putRecord = vi.fn().mockRejectedValue(new Error("NetworkError"));
    const client: RepoClient = { getRecord, putRecord };

    const created = await ensureAccountRecord(client, "com.example.account", "did:plc:alice");

    expect(created).toBe(false);
  });
});
