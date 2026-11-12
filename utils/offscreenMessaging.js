export const OFFSCREEN_RECEIVER_RETRY_DELAYS_MS = Object.freeze([40, 80, 160, 320]);

export function isOffscreenReceiverUnavailableError(error) {
    return /Could not establish connection|Receiving end does not exist/i.test(String(error?.message || error || ""));
}

export async function sendMessageWithReceiverRetry(sendMessage, message, options = {}) {
    const retryDelaysMs = Array.isArray(options.retryDelaysMs)
        ? options.retryDelaysMs
        : OFFSCREEN_RECEIVER_RETRY_DELAYS_MS;
    const wait = typeof options.wait === "function"
        ? options.wait
        : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
    let attempt = 0;
    while (true) {
        try {
            return await sendMessage(message);
        } catch (error) {
            if (!isOffscreenReceiverUnavailableError(error) || attempt >= retryDelaysMs.length) throw error;
            await wait(Math.max(0, Number(retryDelaysMs[attempt]) || 0));
            attempt += 1;
        }
    }
}
