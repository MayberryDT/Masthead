import { createReadStream } from "node:fs";

export type StreamedJsonlLine = {
  byteOffsetAfter: number;
  lineNumber: number;
  raw: string;
};

/** Streams JSONL without retaining the file and skips lines covered by a durable byte cursor. */
export async function* streamJsonlLines(path: string, byteOffset = 0): AsyncIterable<StreamedJsonlLine> {
  let pending = Buffer.alloc(0);
  let byteOffsetAfter = 0;
  let lineNumber = 0;

  for await (const chunk of createReadStream(path)) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    let newline = pending.indexOf(0x0a);
    while (newline >= 0) {
      const line = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      lineNumber += 1;
      byteOffsetAfter += newline + 1;
      if (byteOffsetAfter > byteOffset) {
        const raw = (line.at(-1) === 0x0d ? line.subarray(0, -1) : line).toString("utf8");
        yield { byteOffsetAfter, lineNumber, raw };
      }
      newline = pending.indexOf(0x0a);
    }
  }

  if (pending.length > 0) {
    lineNumber += 1;
    byteOffsetAfter += pending.length;
    if (byteOffsetAfter > byteOffset) {
      const raw = (pending.at(-1) === 0x0d ? pending.subarray(0, -1) : pending).toString("utf8");
      yield { byteOffsetAfter, lineNumber, raw };
    }
  }
}
