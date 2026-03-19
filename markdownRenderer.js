(function initMarkdownRenderer(global) {
    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function splitTableLine(line) {
        return String(line || "")
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => String(cell || "").trim());
    }

    function isTableSeparator(line) {
        return /^\s*\|?[\s:\-|]+\|?\s*$/.test(String(line || ""));
    }

    function renderInline(text) {
        const escaped = escapeHtml(text);
        return escaped
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.+?)\*/g, "<em>$1</em>")
            .replace(/`([^`]+)`/g, "<code>$1</code>");
    }

    function renderParagraph(block) {
        // 将换行符替换为 <br>，并用 <p> 包裹以获得更好的段落间距
        return `<p class="rich-text-paragraph">${renderInline(block).replace(/\n/g, "<br>")}</p>`;
    }

    function renderCodeBlock(block) {
        const lines = String(block || "").split(/\r?\n/);
        const body = lines.slice(1, -1).join("\n");
        return `<pre class="rich-code"><code>${escapeHtml(body)}</code></pre>`;
    }

    function renderTable(headerLine, rowLines) {
        const headers = splitTableLine(headerLine);
        const headHtml = headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
        const bodyHtml = rowLines.map((line) => {
            const cols = splitTableLine(line);
            const cells = headers.map((_, idx) => `<td>${renderInline(cols[idx] || "")}</td>`).join("");
            return `<tr>${cells}</tr>`;
        }).join("");
        return `<div class="rich-table-wrap"><table class="rich-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
    }

    function renderHeader(line) {
        const match = line.match(/^(#{1,6})\s+(.*)$/);
        if (!match) return renderParagraph(line);
        const level = match[1].length;
        const content = match[2];
        return `<h${level}>${renderInline(content)}</h${level}>`;
    }

    function renderList(lines) {
        const items = lines.map((line) => {
            const content = line.replace(/^\s*-\s+/, "");
            return `<li>${renderInline(content)}</li>`;
        }).join("");
        return `<ul>${items}</ul>`;
    }

    function render(markdownText) {
        const text = String(markdownText || "").trim();
        if (!text) return "";
        const lines = text.split(/\r?\n/);
        const out = [];
        let i = 0;
        while (i < lines.length) {
            if (String(lines[i]).trim() === "") {
                i += 1;
                continue;
            }
            if (/^---+$/.test(lines[i].trim())) {
                i += 1;
                continue;
            }

            if (/^```/.test(lines[i])) {
                let j = i + 1;
                while (j < lines.length && !/^```/.test(lines[j])) j += 1;
                if (j < lines.length) j += 1;
                out.push(renderCodeBlock(lines.slice(i, j).join("\n")));
                i = j;
                continue;
            }
            if (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]) && isTableSeparator(lines[i + 1])) {
                let j = i + 2;
                const rowLines = [];
                while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
                    rowLines.push(lines[j]);
                    j += 1;
                }
                out.push(renderTable(lines[i], rowLines));
                i = j;
                continue;
            }
            // Header
            if (/^#{1,6}\s/.test(lines[i])) {
                out.push(renderHeader(lines[i]));
                i += 1;
                continue;
            }
            // List
            if (/^\s*-\s/.test(lines[i])) {
                const listLines = [];
                let j = i;
                while (j < lines.length && /^\s*-\s/.test(lines[j])) {
                    listLines.push(lines[j]);
                    j += 1;
                }
                out.push(renderList(listLines));
                i = j;
                continue;
            }
            
            let j = i;
            const block = [];
            while (j < lines.length && String(lines[j]).trim() !== "") {
                if (j + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[j]) && isTableSeparator(lines[j + 1])) break;
                if (/^```/.test(lines[j])) break;
                if (/^#{1,6}\s/.test(lines[j])) break;
                if (/^\s*-\s/.test(lines[j])) break;
                block.push(lines[j]);
                j += 1;
            }
            if (block.length > 0) {
                out.push(renderParagraph(block.join("\n")));
            }
            i = j;
        }
        return out.join("");
    }

    global.MarkdownRenderer = { render };
})(window);

