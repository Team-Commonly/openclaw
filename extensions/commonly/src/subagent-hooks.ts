import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { CommonlyClient } from "./client.js";
import { resolveCommonlyAccount } from "./types.js";

function summarizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "error";
}

const normalizePodId = (raw: string) =>
  raw.replace(/^commonly:/i, "").replace(/^pod:/i, "").trim();

/**
 * In-memory store mapping childSessionKey → binding info.
 * Cleaned up when the subagent ends.
 */
const bindingStore = new Map<string, {
  postId: string;
  podId: string;
  accountId?: string;
}>();

export function registerCommonlySubagentHooks(api: OpenClawPluginApi) {
  /**
   * subagent_spawning: called when sessions_spawn({ thread: true }) runs.
   * Creates a Commonly post as the thread anchor and stores the binding.
   */
  api.on("subagent_spawning", async (event) => {
    if (!event.threadRequested) return;

    const channel = event.requester?.channel?.trim().toLowerCase();
    if (channel !== "commonly") return;

    const to = event.requester?.to?.trim();
    if (!to) {
      return {
        status: "error" as const,
        error: "Commonly thread bind failed: missing target pod.",
      };
    }

    const podId = normalizePodId(to);
    const accountId = event.requester?.accountId;

    try {
      const account = resolveCommonlyAccount({ cfg: api.config, accountId });
      const client = new CommonlyClient({
        baseUrl: account.baseUrl,
        runtimeToken: account.runtimeToken,
        userToken: account.userToken,
        agentName: account.agentName,
        instanceId: account.instanceId,
      });

      const threadTitle = event.label
        ? `${event.agentId}: ${event.label}`
        : `${event.agentId} session`;

      const post = await client.createPost(threadTitle, {
        podId,
        category: "General",
      });

      bindingStore.set(event.childSessionKey, {
        postId: post._id,
        podId,
        accountId,
      });

      return { status: "ok" as const, threadBindingReady: true };
    } catch (err) {
      return {
        status: "error" as const,
        error: `Commonly thread bind failed: ${summarizeError(err)}`,
      };
    }
  });

  /**
   * subagent_delivery_target: resolves where the subagent's completion
   * message should be delivered. Routes it to the thread post.
   */
  api.on("subagent_delivery_target", (event) => {
    if (!event.expectsCompletionMessage) return;

    const requesterChannel = event.requesterOrigin?.channel?.trim().toLowerCase();
    if (requesterChannel !== "commonly") return;

    const binding = bindingStore.get(event.childSessionKey);
    if (!binding) return;

    return {
      origin: {
        channel: "commonly",
        accountId: binding.accountId,
        to: binding.podId,
        threadId: binding.postId,
      },
    };
  });

  /**
   * subagent_ended: clean up the binding when the session ends.
   */
  api.on("subagent_ended", (event) => {
    bindingStore.delete(event.targetSessionKey);
  });
}
