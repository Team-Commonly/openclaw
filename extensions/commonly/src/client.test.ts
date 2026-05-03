import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommonlyClient } from "./client.js";

const createResponse = (data: unknown = {}) => ({
  ok: true,
  json: async () => data,
});

describe("CommonlyClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses runtime token for runtime endpoints", async () => {
    fetchMock.mockResolvedValue(createResponse({ id: "msg-1" }));
    const client = new CommonlyClient({
      baseUrl: "http://localhost:5000",
      runtimeToken: "rt",
    });

    await client.postMessage("pod-123", "hello");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5000/api/agents/runtime/pods/pod-123/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer rt" }),
      }),
    );
  });

  it("uses user token for user endpoints when provided", async () => {
    fetchMock.mockResolvedValue(createResponse({ results: [] }));
    const client = new CommonlyClient({
      baseUrl: "http://localhost:5000",
      runtimeToken: "rt",
      userToken: "ut",
    });

    await client.search("pod-123", "query");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5000/api/v1/search/pod-123?q=query",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ut" }),
      }),
    );
  });

  it("falls back to runtime token for user endpoints", async () => {
    fetchMock.mockResolvedValue(createResponse({ results: [] }));
    const client = new CommonlyClient({
      baseUrl: "http://localhost:5000",
      runtimeToken: "rt",
    });

    await client.search("pod-123", "query");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5000/api/v1/search/pod-123?q=query",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer rt" }),
      }),
    );
  });

  it("throws when runtime token is missing for runtime endpoints", async () => {
    fetchMock.mockResolvedValue(createResponse({}));
    const client = new CommonlyClient({ baseUrl: "http://localhost:5000" });

    await expect(client.postMessage("pod-123", "hello")).rejects.toThrow(
      "Commonly runtime token is required",
    );
  });

  // ADR-003 Phase 2: memory envelope + sync
  describe("agent memory envelope", () => {
    it("readAgentMemory returns both v1 content and v2 sections", async () => {
      fetchMock.mockResolvedValue(
        createResponse({
          content: "v1 blob",
          sections: { long_term: { content: "v2 curated" } },
          sourceRuntime: "openclaw",
          schemaVersion: 2,
        }),
      );
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
      const r = await client.readAgentMemory();
      expect(r.content).toBe("v1 blob");
      expect(r.sections?.long_term?.content).toBe("v2 curated");
      expect(r.sourceRuntime).toBe("openclaw");
      expect(r.schemaVersion).toBe(2);
    });

    it("syncAgentMemory posts to /memory/sync with the given mode and sections", async () => {
      fetchMock.mockResolvedValue(createResponse({ ok: true, schemaVersion: 2 }));
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });

      const r = await client.syncAgentMemory(
        { long_term: { content: "hi" } },
        { mode: "patch", sourceRuntime: "openclaw" },
      );
      expect(r.ok).toBe(true);
      expect(r.schemaVersion).toBe(2);

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:5000/api/agents/runtime/memory/sync",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer rt" }),
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({
        sections: { long_term: { content: "hi" } },
        mode: "patch",
        sourceRuntime: "openclaw",
      });
    });

    it("syncAgentMemory omits sourceRuntime from the body when not provided", async () => {
      fetchMock.mockResolvedValue(createResponse({ ok: true }));
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
      await client.syncAgentMemory({ dedup_state: { content: "## C\n{}" } }, { mode: "full" });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({
        sections: { dedup_state: { content: "## C\n{}" } },
        mode: "full",
      });
      expect(body.sourceRuntime).toBeUndefined();
    });

    it("syncAgentMemory surfaces deduped:true when kernel dedupes", async () => {
      fetchMock.mockResolvedValue(createResponse({ ok: true, deduped: true }));
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
      const r = await client.syncAgentMemory({ long_term: { content: "x" } }, { mode: "patch" });
      expect(r.deduped).toBe(true);
    });

    it("syncAgentMemory throws with status + body on 4xx", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => '{"message":"mode must be full or patch"}',
      });
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
      await expect(
        client.syncAgentMemory({ long_term: { content: "x" } }, { mode: "patch" }),
      ).rejects.toThrow(/400/);
    });
  });

  describe("agent-dm", () => {
    it("openAgentDm POSTs target shape with default instanceId omitted", async () => {
      fetchMock.mockResolvedValue(createResponse({ room: { _id: "pod-dm-1", name: "Pixel ↔ Aria" }, autoJoined: false }));
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });

      const r = await client.openAgentDm({ agentName: "openclaw", instanceId: "aria" }, "pod-team-1");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:5000/api/agents/runtime/agent-dm",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer rt" }),
        }),
      );
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
      expect(body.target).toEqual({ agentName: "openclaw", instanceId: "aria" });
      expect(body.originPodId).toBe("pod-team-1");
      expect(r.room._id).toBe("pod-dm-1");
    });

    it("openAgentDm omits instanceId when not provided (defaults to 'default' server-side)", async () => {
      fetchMock.mockResolvedValue(createResponse({ room: { _id: "pod-dm-2" }, autoJoined: false }));
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });

      await client.openAgentDm({ agentName: "codex" });

      const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
      expect(body.target).toEqual({ agentName: "codex" });
      expect(body.originPodId).toBeUndefined();
    });

    it("openAgentDm surfaces 403 from co-pod-member rule", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => '{"message":"No shared pod with target"}',
      });
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
      await expect(client.openAgentDm({ agentName: "stranger" })).rejects.toThrow(/403/);
    });
  });
});
