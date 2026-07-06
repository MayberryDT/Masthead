import type { BoardHeadlineInput } from "./boardHeadlineInput.ts";

export function hasHeadlineTranscriptEvidence(input: BoardHeadlineInput): boolean {
  return meaningfulTranscriptMessages(input).length > 0;
}

export function boardHeadlineRefreshKey(model: string, input: BoardHeadlineInput): string | undefined {
  const transcriptMessages = meaningfulTranscriptMessages(input);
  if (transcriptMessages.length === 0) return undefined;

  return JSON.stringify({
    model,
    lifecycle: clean(input.lifecycle),
    primaryStatus: clean(input.primaryStatus),
    stateHint: input.stateHint,
    signals: input.signals,
    transcriptMessages,
    recentCommandFailures: cleanList(input.facts.recentCommandFailures, 4),
    attentionTitles: cleanList(input.facts.attentionTitles, 4),
    conflictTitles: cleanList(input.facts.conflictTitles, 4)
  });
}

function meaningfulTranscriptMessages(input: BoardHeadlineInput): string[] {
  const excerptMessages = cleanList(
    (input.facts.transcriptExcerpt ?? [])
      .map((message) => {
        const text = clean(message.text);
        if (!text || isLowValueHeadlineEvidence(text)) return undefined;
        return `${message.role}: ${text}`;
      })
      .filter((message): message is string => Boolean(message)),
    20
  );
  if (excerptMessages.length > 0) return excerptMessages;

  return cleanList(input.facts.recentTranscriptMessages ?? [], 8).filter((message) => !isLowValueHeadlineEvidence(message));
}

function cleanList(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = clean(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isLowValueHeadlineEvidence(value: string): boolean {
  const normalized = clean(value);
  return /^(live hook event|runtime signal|unknown|shell)$/i.test(normalized);
}
