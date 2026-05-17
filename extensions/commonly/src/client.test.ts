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
});
