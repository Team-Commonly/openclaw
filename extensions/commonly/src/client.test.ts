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

  describe("reactToMessage", () => {
    it("POSTs to /api/messages/:id/reactions with the emoji in the body", async () => {
      fetchMock.mockResolvedValue(createResponse({ ok: true }));
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });

      await client.reactToMessage("msg-42", "🎉");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:5000/api/messages/msg-42/reactions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer rt" }),
        }),
      );
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
      expect(body).toEqual({ emoji: "🎉" });
    });

    it("DELETEs /api/messages/:id/reactions/:emoji when remove=true", async () => {
      fetchMock.mockResolvedValue(createResponse({ ok: true }));
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });

      await client.reactToMessage("msg-42", "🎉", { remove: true });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://localhost:5000/api/messages/msg-42/reactions/%F0%9F%8E%89");
      expect((init as { method: string }).method).toBe("DELETE");
    });

    it("surfaces status + body on non-2xx (e.g. 403 dm_membership_refused)", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => '{"code":"dm_membership_refused"}',
      });
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
      await expect(client.reactToMessage("msg-42", "🎉")).rejects.toThrow(/403/);
    });
  });

  describe("typed agent memory", () => {
    it("reads the v1 blob and v2 typed sections together", async () => {
      fetchMock.mockResolvedValue(
        createResponse({
          content: "legacy",
          sections: { long_term: { content: "curated" } },
          sourceRuntime: "openclaw",
          schemaVersion: 2,
        }),
      );
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });

      const result = await client.readAgentMemory();

      expect(result.content).toBe("legacy");
      expect(result.sections?.long_term?.content).toBe("curated");
      expect(result.sourceRuntime).toBe("openclaw");
      expect(result.schemaVersion).toBe(2);
    });

    it("syncs a typed memory patch through the runtime endpoint", async () => {
      fetchMock.mockResolvedValue(createResponse({ ok: true, schemaVersion: 2 }));
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });

      await client.syncAgentMemory(
        { long_term: { content: "remember this" } },
        { mode: "patch", sourceRuntime: "openclaw" },
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:5000/api/agents/runtime/memory/sync",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer rt" }),
        }),
      );
      expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({
        sections: { long_term: { content: "remember this" } },
        mode: "patch",
        sourceRuntime: "openclaw",
      });
    });

    it("preserves the append-only cycles payload shape", async () => {
      fetchMock.mockResolvedValue(createResponse({ ok: true, cyclesAppended: true }));
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });

      await client.syncAgentMemory(
        { cycles: { append: { content: "verified a port", podId: "pod-1" } } },
        { mode: "patch", sourceRuntime: "openclaw" },
      );

      expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({
        sections: { cycles: { append: { content: "verified a port", podId: "pod-1" } } },
        mode: "patch",
        sourceRuntime: "openclaw",
      });
    });
  });

  describe("agent DM", () => {
    it("opens a DM with its target identity and runtime token", async () => {
      fetchMock.mockResolvedValue(
        createResponse({ room: { _id: "dm-1", name: "Peer" }, autoJoined: false }),
      );
      const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });

      const result = await client.openAgentDm(
        { agentName: "openclaw", instanceId: "peer" },
        "pod-1",
      );

      expect(result.room._id).toBe("dm-1");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:5000/api/agents/runtime/agent-dm",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer rt" }),
        }),
      );
      expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({
        target: { agentName: "openclaw", instanceId: "peer" },
        originPodId: "pod-1",
      });
    });
  });

  it("reads a pod attachment with the runtime token", async () => {
    const bytes = new TextEncoder().encode("attachment text");
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    });
    const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });

    await expect(client.readAttachment("brief.txt")).resolves.toEqual(
      Buffer.from("attachment text"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5000/api/uploads/brief.txt",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer rt" }) }),
    );
  });
});
