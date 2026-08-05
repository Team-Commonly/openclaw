import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommonlyClient } from "./client.js";
import { CommonlyTools } from "./tools.js";

describe("CommonlyTools runtime forward port", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers every tool that was absent from the main-line extension", () => {
    const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
    const names = new CommonlyTools(client).getToolDefinitions().map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "commonly_read_my_memory",
        "commonly_save_my_memory",
        "commonly_log_cycle",
        "commonly_open_dm",
        "commonly_read_attachment",
      ]),
    );
  });

  it("sends the kernel's append-only cycles payload", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, cyclesAppended: true, truncated: false, evicted: false }),
    });
    const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
    const tools = new CommonlyTools(client);

    const result = (await tools.execute("commonly_log_cycle", {
      content: "attachment ACL landed",
      podId: "pod-1",
    })) as { details: { truncated?: boolean; evicted?: boolean } };

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5000/api/agents/runtime/memory/sync",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({
      sections: { cycles: { append: { content: "attachment ACL landed", podId: "pod-1" } } },
      mode: "patch",
      sourceRuntime: "openclaw",
    });
    expect(result.details).toMatchObject({ truncated: false, evicted: false });
  });

  it("reads and patches typed memory through the forward-ported tools", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: "legacy memory",
          sections: { long_term: { content: "typed memory" } },
          schemaVersion: 2,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, schemaVersion: 2 }) });
    const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
    const tools = new CommonlyTools(client);

    await tools.execute("commonly_read_my_memory", { section: "long_term" });
    await tools.execute("commonly_save_my_memory", {
      section: "long_term",
      content: "new typed memory",
      visibility: "private",
    });

    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:5000/api/agents/runtime/memory");
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body)).toEqual({
      sections: { long_term: { content: "new typed memory", visibility: "private" } },
      mode: "patch",
      sourceRuntime: "openclaw",
    });
  });

  it("opens a shared-context agent DM through the forward-ported tool", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ room: { _id: "dm-1", name: "Peer" }, autoJoined: false }),
    });
    const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
    const tools = new CommonlyTools(client);

    await tools.execute("commonly_open_dm", {
      agentName: "peer-agent",
      instanceId: "peer-instance",
      originPodId: "shared-pod",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5000/api/agents/runtime/agent-dm",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({
      target: { agentName: "peer-agent", instanceId: "peer-instance" },
      originPodId: "shared-pod",
    });
  });

  it("uses the client runtime token when reading a text attachment", async () => {
    const bytes = new TextEncoder().encode("brief contents");
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer });
    const client = new CommonlyClient({ baseUrl: "http://localhost:5000", runtimeToken: "rt" });
    const tools = new CommonlyTools(client);

    await tools.execute("commonly_read_attachment", { fileName: "brief.txt" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5000/api/uploads/brief.txt",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer rt" }) }),
    );
  });
});
