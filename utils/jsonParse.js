function repairTruncatedJSON(str) {
  let next = String(str || "").trim();
  const openBraces = (next.match(/\{/g) || []).length;
  const closeBraces = (next.match(/\}/g) || []).length;
  for (let i = 0; i < openBraces - closeBraces; i++) next += "}";
  const openBrackets = (next.match(/\[/g) || []).length;
  const closeBrackets = (next.match(/\]/g) || []).length;
  for (let i = 0; i < openBrackets - closeBrackets; i++) next += "]";
  return next;
}

function repairUnescapedQuotes(str) {
  const source = String(str || "");
  const closers = new Set([",", "}", "]", ":"]);
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (!inString) {
      if (ch === "\"") {
        inString = true;
      }
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      let j = i + 1;
      while (j < source.length && /\s/.test(source[j])) j++;
      const next = source[j] || "";
      if (closers.has(next) || !next) {
        inString = false;
        out += ch;
      } else {
        out += "\\\"";
      }
      continue;
    }
    out += ch;
  }
  return out;
}

export function robustJSONParse(str) {
  if (!str) return null;

  let content = String(str);

  // 1. Remove Markdown code blocks
  content = content.replace(/```json\s*([\s\S]*?)\s*```/gi, '$1');
  content = content.replace(/```\s*([\s\S]*?)\s*```/gi, '$1');

  // 2. Try parsing directly first
  try {
      return JSON.parse(content);
  } catch (e) {
      // Continue to extraction logic
  }

  // 3. Extract first valid JSON object/array
  const firstOpenBrace = content.indexOf('{');
  const firstOpenBracket = content.indexOf('[');
  
  let start = -1;
  let end = -1;

  if (firstOpenBrace !== -1 && (firstOpenBracket === -1 || firstOpenBrace < firstOpenBracket)) {
      start = firstOpenBrace;
      end = content.lastIndexOf('}');
  } else if (firstOpenBracket !== -1) {
      start = firstOpenBracket;
      end = content.lastIndexOf(']');
  }

  if (start !== -1 && end !== -1 && end >= start) {
      content = content.substring(start, end + 1);
  } else if (start !== -1) {
      content = content.substring(start);
  } else {
      // No JSON structure found
      return null;
  }

  // 4. Try parsing extracted content
  try {
      return JSON.parse(content);
  } catch (e) {
      try {
          // Fix trailing commas
          let fixed = content.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
          // Attempt repair truncated JSON
          let repaired = repairTruncatedJSON(fixed);
          try {
             return JSON.parse(repaired);
          } catch (e3) {
             // Attempt repair unescaped quotes
             repaired = repairUnescapedQuotes(repaired);
             return JSON.parse(repaired);
          }
      } catch (e2) {
          console.error("JSON Parse Failed:", e2, content);
          return null; // Return null instead of throwing to avoid crashing
      }
  }
}
