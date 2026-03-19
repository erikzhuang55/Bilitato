/**
 * 字幕预处理模块 (Subtitle Preprocessor)
 * 纯算法实现，不依赖 LLM
 */

const SubtitleProcessor = {
    // 核心入口
    process(subtitles) {
        if (!Array.isArray(subtitles) || subtitles.length === 0) return [];

        // 1. 标准化 & 2. 过滤 & 3. 去语气词
        let cleaned = subtitles
            .map(this._normalize)
            .filter(item => this._isValid(item));

        // 4. 按时间合并 (30s window)
        let merged = this._mergeByTime(cleaned, 30);

        // 5. 相邻去重
        let deduped = this._removeDuplicates(merged);

        return deduped;
    },

    // ── 第一步：文本标准化 ──
    _normalize(item) {
        let text = item.text || item.content || '';
        
        // 全角转半角
        text = text.replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
                   .replace(/\u3000/g, ' ');

        // 去除无意义括号内容 (如 [笑声], (鼓掌))
        text = text.replace(/(\[.*?\]|\(.*?\)|（.*?）|【.*?】)/g, '');

        // 去除首尾空格 & 合并多余空格
        text = text.trim().replace(/\s+/g, ' ');

        return { ...item, text };
    },

    // ── 第二步 & 第三步：过滤逻辑 ──
    _isValid(item) {
        let text = item.text;
        
        // 2.1 长度过滤
        if (text.length < 2) return false; // 放宽到2，避免误删短词

        // 2.2 互动引导过滤
        const interactionKeywords = ['点赞', '投币', '关注', '转发', '收藏', '评论区', '一键三连', '弹幕', '订阅'];
        if (interactionKeywords.some(kw => text.includes(kw))) return false;

        // 3. 语气词处理 (仅针对短句进行强过滤，长句保留以防误删)
        // 如果包含关键事实信息（数字、年份、百分比），则绝对保留
        if (/\d+|%|元|年|月|日/.test(text)) return true;

        const fillers = ['嗯', '啊', '呃', '额', '那个', '这个', '就是', '其实', '然后', '所以', '你知道', '我跟你讲', '怎么说呢', '基本上', '的话', '那么'];
        // 如果整句话就是填充词，直接删掉
        if (fillers.includes(text)) return false;
        
        // 尝试去除开头的填充词
        for (const f of fillers) {
            if (text.startsWith(f)) {
                text = text.slice(f.length).trim();
            }
        }
        item.text = text; // 更新引用

        // 再次检查长度
        return text.length >= 2;
    },

    // ── 第四步：按时间合并 ──
    _mergeByTime(items, windowSec = 30) {
        if (!items.length) return [];
        
        let result = [];
        let currentBlock = {
            start: items[0].from ?? items[0].start ?? 0,
            end: items[0].to ?? items[0].end ?? 0,
            texts: [items[0].text]
        };
        
        // 辅助函数：生成简短时间戳 [m:s]
        const getCompactTs = (sec) => {
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            return `[${m}:${String(s).padStart(2,'0')}]`;
        };
        
        // 初始块带时间戳
        currentBlock.formattedText = `${getCompactTs(currentBlock.start)} ${items[0].text}`;

        for (let i = 1; i < items.length; i++) {
            const item = items[i];
            const start = item.from ?? item.start ?? 0;
            const end = item.to ?? item.end ?? 0;
            
            // 检查是否在当前时间窗口内
            const inWindow = (start - currentBlock.start) < windowSec;
            // 检查间隔是否过大 (大于2秒不强行拼接)
            const isGapSmall = (start - items[i-1].to ?? items[i-1].end ?? 0) <= 2;

            if (inWindow && isGapSmall) {
                // 每句（或每隔一句）插入时间戳
                // 策略：如果当前句子距离上一句超过5秒，或者字数积累较多，插入时间戳
                // 为了节省 Token 且保持引用能力，我们在每句开始前都插入时间戳可能会太密
                // 现在的需求是：每一句（或者每两句）文字前插入一个简短的时间标记
                // 让我们尝试每句都插，但紧凑一点。
                
                // 为了避免过于密集，我们检测当前块内上一条文本的长度，如果很短（<10字），也许可以合并？
                // 但用户要求明确引用，所以每句带时间戳是最安全的引用方式。
                
                currentBlock.texts.push(item.text);
                currentBlock.end = end;
                currentBlock.formattedText += ` ${getCompactTs(start)} ${item.text}`;
            } else {
                // 结算当前块
                result.push({
                    start: currentBlock.start,
                    end: currentBlock.end,
                    text: currentBlock.formattedText // 使用带时间戳的文本
                });
                
                // 开启新块
                currentBlock = {
                    start: start,
                    end: end,
                    texts: [item.text],
                    formattedText: `${getCompactTs(start)} ${item.text}`
                };
            }
        }
        // 推送最后一个块
        result.push({
            start: currentBlock.start,
            end: currentBlock.end,
            text: currentBlock.formattedText
        });

        return result;
    },

    // ── 第五步：相邻去重 (Jaccard Similarity) ──
    _removeDuplicates(items) {
        if (items.length < 2) return items;
        
        const getGrams = (text) => {
            const grams = new Set();
            for (let i = 0; i < text.length - 1; i++) {
                grams.add(text.slice(i, i + 2));
            }
            return grams;
        };

        const jaccard = (s1, s2) => {
            const g1 = getGrams(s1);
            const g2 = getGrams(s2);
            if (g1.size === 0 || g2.size === 0) return 0;
            const intersection = new Set([...g1].filter(x => g2.has(x)));
            const union = new Set([...g1, ...g2]);
            return intersection.size / union.size;
        };

        let result = [items[0]];
        for (let i = 1; i < items.length; i++) {
            const prev = result[result.length - 1];
            const curr = items[i];
            
            // 相似度 > 0.85 视为重复 (0.9可能太严)
            if (jaccard(prev.text, curr.text) > 0.85) {
                // 保留较长的那个
                if (curr.text.length > prev.text.length) {
                    result[result.length - 1] = curr;
                }
            } else {
                result.push(curr);
            }
        }
        return result;
    }
};

// 兼容 CommonJS 和 ES Module (如果是在浏览器环境直接挂载)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SubtitleProcessor;
} else {
    window.SubtitleProcessor = SubtitleProcessor;
}
