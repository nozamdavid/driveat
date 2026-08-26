import { HttpError, json, readJson } from "./http.js";
import type { MediaMapping } from "./types.js";

export class MediaRegistry implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    try { return await this.route(request); } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code }, error.status);
      return json({ error: "internal-error" }, 500);
    }
  }

  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/batch") {
      const mappings = await readJson<MediaMapping[]>(request);
      if (mappings.length === 0 || mappings.length > 100) throw new HttpError(400, "invalid-media-batch");
      const entries: Record<string, MediaMapping> = {};
      for (const mapping of mappings) {
        if (!/^[A-Za-z0-9_-]{8,128}$/u.test(mapping.mediaId)) throw new HttpError(400, "invalid-media-id");
        entries[`media:${mapping.mediaId}`] = mapping;
      }
      await this.state.storage.put(entries);
      return json({ stored: mappings.length }, 201);
    }
    const mediaId = decodeURIComponent(url.pathname.slice(1));
    if (!/^[A-Za-z0-9_-]{8,128}$/u.test(mediaId)) return json({ error: "invalid-media-id" }, 400);
    if (request.method === "PUT") {
      const mapping = await readJson<MediaMapping>(request);
      if (mapping.mediaId !== mediaId) throw new HttpError(400, "media-id-mismatch");
      await this.state.storage.put(`media:${mediaId}`, mapping);
      return json({ stored: true }, 201);
    }
    if (request.method === "GET") {
      const mapping = await this.state.storage.get<MediaMapping>(`media:${mediaId}`);
      return mapping === undefined ? json({ error: "media-not-found" }, 404) : json(mapping);
    }
    return json({ error: "method-not-allowed" }, 405);
  }
}
