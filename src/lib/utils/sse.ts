import type { ParsedSSEEvent } from "@/types/message";

/**
 * 解析 SSE 流数据为结构化事件数组
 */
export function parseSSEData(sseText: string): ParsedSSEEvent[] {
  const events: ParsedSSEEvent[] = [];

  let eventName = "";
  let dataLines: string[] = [];

  const flushEvent = () => {
    // 修改：支持没有 event: 前缀的纯 data: 格式（Gemini 流式响应）
    // 如果没有 eventName，使用默认值 "message"
    if (dataLines.length === 0) {
      eventName = "";
      dataLines = [];
      return;
    }

    const dataStr = dataLines.join("\n");

    try {
      const data = JSON.parse(dataStr);
      events.push({ event: eventName || "message", data });
    } catch {
      events.push({ event: eventName || "message", data: dataStr });
    }

    eventName = "";
    dataLines = [];
  };

  const lines = sseText.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line) {
      flushEvent();
      continue;
    }

    if (line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      eventName = line.substring(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      let value = line.substring(5);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
      dataLines.push(value);
    }
  }

  flushEvent();

  return events;
}

/**
 * 从增量 SSE 文本中提取首个“完整且包含 data 行”的事件。
 *
 * 说明：
 * - 只在遇到空行时认定事件完成；不会像 parseSSEData 一样在 EOF 强制 flush。
 * - 会忽略前置 comment/keep-alive 与不含 data 的空事件块。
 * - 返回值仅用于首事件门控检测，不用于重建原始字节流。
 */
export function extractFirstCompleteSSEEvent(sseText: string): string | null {
  let blockLines: string[] = [];
  let hasDataLine = false;

  const flushEvent = () => {
    if (!hasDataLine) {
      blockLines = [];
      hasDataLine = false;
      return null;
    }

    const eventText = `${blockLines.join("\n")}\n\n`;
    blockLines = [];
    hasDataLine = false;
    return eventText;
  };

  const lines = sseText.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trimEnd();

    if (!line) {
      const eventText = flushEvent();
      if (eventText) {
        return eventText;
      }
      continue;
    }

    if (line.startsWith(":")) {
      if (blockLines.length > 0) {
        blockLines.push(rawLine);
      }
      continue;
    }

    if (line.startsWith("data:")) {
      hasDataLine = true;
    }

    blockLines.push(rawLine);
  }

  return null;
}

/**
 * 严格检测文本是否“看起来像” SSE。
 *
 * 只认行首的 `event:` / `data:`（或前置注释行 `:`），避免 JSON 里包含 "data:" 误判。
 */
export function isSSEText(text: string): boolean {
  let start = 0;

  for (let i = 0; i <= text.length; i += 1) {
    if (i !== text.length && text.charCodeAt(i) !== 10) continue; // '\n'

    const line = text.slice(start, i).trim();
    start = i + 1;

    if (!line) continue;
    if (line.startsWith(":")) continue;

    return line.startsWith("event:") || line.startsWith("data:");
  }

  return false;
}

/**
 * 用于 UI 展示的 SSE 解析（在 parseSSEData 基础上做轻量清洗）。
 */
export function parseSSEDataForDisplay(sseText: string): ParsedSSEEvent[] {
  return parseSSEData(sseText).filter((evt) => {
    if (typeof evt.data !== "string") return true;
    return evt.data.trim() !== "[DONE]";
  });
}
