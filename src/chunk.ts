import { config } from './config.js';
import type { Block } from './extract.js';
import type { Chunk } from './types.js';

/**
 * Group extracted blocks into retrieval passages. Blocks are never split across
 * passages, so a citation always points at whole sentences, and each passage
 * carries the nearest heading above it so an answer can say where in the page
 * the evidence came from.
 */
export function buildChunks(
  sourceId: string,
  blocks: Block[],
  options: { targetChars?: number; maxChars?: number } = {},
): Chunk[] {
  const target = options.targetChars ?? config.chunking.targetChars;
  const max = options.maxChars ?? config.chunking.maxChars;

  const chunks: Chunk[] = [];
  let heading: string | null = null;
  let pending: string[] = [];
  let pendingLength = 0;
  let pendingHeading: string | null = null;

  const flush = () => {
    if (pending.length === 0) return;
    chunks.push({
      id: `${sourceId}#${chunks.length}`,
      sourceId,
      index: chunks.length,
      heading: pendingHeading,
      text: pending.join('\n'),
    });
    pending = [];
    pendingLength = 0;
  };

  for (const block of blocks) {
    if (block.kind === 'heading') {
      // A heading always starts a new passage. On a page that lists several
      // priced plans one after another, letting passages run across a heading
      // welds the plans together and a retrieved passage can no longer say
      // which price belongs to which plan.
      flush();
      heading = block.text;
      pendingHeading = heading;
      continue;
    }

    if (block.text.length > max) {
      // A single oversized block (a wall-of-text paragraph) is split on sentence
      // boundaries rather than truncated, so no evidence is silently lost.
      flush();
      for (const piece of splitLongBlock(block.text, max)) {
        pendingHeading = heading;
        pending.push(piece);
        pendingLength = piece.length;
        flush();
      }
      continue;
    }

    if (pendingLength > 0 && pendingLength + block.text.length + 1 > max) flush();
    if (pending.length === 0) pendingHeading = heading;

    pending.push(block.text);
    pendingLength += block.text.length + 1;
    if (pendingLength >= target) flush();
  }
  flush();

  return chunks;
}

function splitLongBlock(text: string, max: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length > 0 && current.length + sentence.length > max) {
      pieces.push(current.trim());
      current = '';
    }
    // A single sentence longer than the cap is emitted whole rather than cut
    // mid-word; passages are a retrieval unit, not a hard storage limit.
    current += sentence;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}
