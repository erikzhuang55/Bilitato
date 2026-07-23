export function getAsrAudioCandidateUrls(media = {}) {
    const rawUrls = [
        media?.url,
        ...(Array.isArray(media?.urls) ? media.urls : [])
    ];
    const seen = new Set();
    return rawUrls
        .map((value) => String(value || "").trim())
        .filter((value) => {
            if (!/^https?:\/\//i.test(value) || seen.has(value)) return false;
            seen.add(value);
            return true;
        });
}
