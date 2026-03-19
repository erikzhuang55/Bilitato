const SubtitleProcessor = {
    process(subtitles) {
        if (!Array.isArray(subtitles) || subtitles.length === 0) return [];
        let cleaned = subtitles.map(this._normalize).filter(item => this._isValid(item));
        let merged = this._mergeByTime(cleaned, 30);
        let deduped = this._removeDuplicates(merged);
        return deduped;
    },
    _normalize(item) {
        let text = item.text || item.content || '';
        text = text.replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
        text = text.replace(/(\[.*?\]|\(.*?\)|（.*?）|【.*?】)/g, '');
        text = text.trim().replace(/\s+/g, ' ');
        return { ...item, text };
    },
    _isValid(item) {
        let text = item.text;
        if (text.length < 2) return false;
        const interactionKeywords = ['点赞', '投币', '关注', '转发', '收藏', '评论区', '一键三连', '弹幕', '订阅'];
        if (interactionKeywords.some(kw => text.includes(kw))) return false;
        if (/\d+|%|元|年|月|日/.test(text)) return true;
        const fillers = ['嗯', '啊', '呃', '额', '那个', '这个', '就是', '其实', '然后', '所以', '你知道', '我跟你讲', '怎么说呢', '基本上', '的话', '那么'];
        if (fillers.includes(text)) return false;
        for (const f of fillers) { if (text.startsWith(f)) text = text.slice(f.length).trim(); }
        item.text = text;
        return text.length >= 2;
    },
    _mergeByTime(items, windowSec = 30) {
        if (!items.length) return [];
        let result = [];
        let currentBlock = { start: items[0].from ?? items[0].start ?? 0, end: items[0].to ?? items[0].end ?? 0, texts: [items[0].text] };
        const getCompactTs = (sec) => { const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return `[${m}:${String(s).padStart(2,'0')}]`; };
        currentBlock.formattedText = `${getCompactTs(currentBlock.start)} ${items[0].text}`;
        for (let i = 1; i < items.length; i++) {
            const item = items[i];
            const start = item.from ?? item.start ?? 0;
            const end = item.to ?? item.end ?? 0;
            const inWindow = (start - currentBlock.start) < windowSec;
            const isGapSmall = (start - (items[i-1].to ?? items[i-1].end ?? 0)) <= 2;
            if (inWindow && isGapSmall) {
                currentBlock.texts.push(item.text);
                currentBlock.end = end;
                currentBlock.formattedText += ` ${getCompactTs(start)} ${item.text}`;
            } else {
                result.push({ start: currentBlock.start, end: currentBlock.end, text: currentBlock.formattedText });
                currentBlock = { start: start, end: end, texts: [item.text], formattedText: `${getCompactTs(start)} ${item.text}` };
            }
        }
        result.push({ start: currentBlock.start, end: currentBlock.end, text: currentBlock.formattedText });
        return result;
    },
    _removeDuplicates(items) {
        if (items.length < 2) return items;
        const getGrams = (text) => { const grams = new Set(); for (let i = 0; i < text.length - 1; i++) { grams.add(text.slice(i, i + 2)); } return grams; };
        const jaccard = (s1, s2) => {
            const g1 = getGrams(s1); const g2 = getGrams(s2);
            if (g1.size === 0 || g2.size === 0) return 0;
            const intersection = new Set([...g1].filter(x => g2.has(x))); const union = new Set([...g1, ...g2]);
            return intersection.size / union.size;
        };
        let result = [items[0]];
        for (let i = 1; i < items.length; i++) {
            const prev = result[result.length - 1]; const curr = items[i];
            if (jaccard(prev.text, curr.text) > 0.85) { if (curr.text.length > prev.text.length) { result[result.length - 1] = curr; } } else { result.push(curr); }
        }
        return result;
    }
};

export default SubtitleProcessor;
