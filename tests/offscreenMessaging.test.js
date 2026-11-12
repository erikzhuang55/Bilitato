import { describe, expect, it, vi } from "vitest";
import {
  isOffscreenReceiverUnavailableError,
  sendMessageWithReceiverRetry
} from "../utils/offscreenMessaging.js";

describe("offscreen message retry", () => {
  it("retries when the receiver is not ready and succeeds on the second attempt", async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({ ok: true, ready: true });
    const wait = vi.fn(async () => {});

    const result = await sendMessageWithReceiverRetry(sendMessage, { action: "OFFSCREEN_PING" }, {
      retryDelaysMs: [10],
      wait
    });

    expect(result).toEqual({ ok: true, ready: true });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(10);
  });

  it("does not retry unrelated errors", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("Groq request failed"));

    await expect(sendMessageWithReceiverRetry(sendMessage, { action: "OFFSCREEN_PING" }, {
      retryDelaysMs: [0],
      wait: async () => {}
    })).rejects.toThrow("Groq request failed");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(isOffscreenReceiverUnavailableError(new Error("Groq request failed"))).toBe(false);
  });
});
