import { describe, expect, it } from "vitest";
import type { CommonlyEvent } from "../../../src/channels/commonly/events.js";
import { resolveInboundBody } from "./channel.js";

describe("commonly heartbeat body resolution", () => {
  it("uses fallback content for heartbeat events without payload.content", () => {
    const event: CommonlyEvent = {
      _id: "evt-heartbeat",
      type: "heartbeat",
      podId: "pod-1",
      payload: {
        trigger: "scheduled-hourly",
      },
    };

    const body = resolveInboundBody(event);
    expect(body).toContain("System heartbeat from Commonly scheduler");
  });

  it("prefers explicit heartbeat payload content when provided", () => {
    const event: CommonlyEvent = {
      _id: "evt-heartbeat-custom",
      type: "heartbeat",
      podId: "pod-1",
      payload: {
        content: "Check recent pod messages and only reply if needed.",
      },
    };

    const body = resolveInboundBody(event);
    expect(body).toBe("Check recent pod messages and only reply if needed.");
  });
});
