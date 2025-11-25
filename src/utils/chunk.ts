/**
 * Text chunking utilities for splitting documents into manageable pieces
 */

export interface Chunk {
  text: string;
  index: number;
  startChar: number;
  endChar: number;
}

/**
 * Split text into chunks of approximately the target size
 * Attempts to break at sentence boundaries when possible
 */
export function chunkText(
  text: string,
  targetChunkSize: number = 500,
  overlap: number = 50
): Chunk[] {
  const chunks: Chunk[] = [];
  let currentIndex = 0;
  let chunkIndex = 0;

  // Split by paragraphs first, then by sentences
  const paragraphs = text.split(/\n\s*\n/);

  for (const paragraph of paragraphs) {
    if (paragraph.trim().length === 0) continue;

    // If paragraph is small enough, add it as a chunk
    if (paragraph.length <= targetChunkSize) {
      chunks.push({
        text: paragraph.trim(),
        index: chunkIndex++,
        startChar: currentIndex,
        endChar: currentIndex + paragraph.length,
      });
      currentIndex += paragraph.length + 2; // +2 for paragraph break
      continue;
    }

    // Otherwise, split by sentences
    const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
    let currentChunk = "";

    for (const sentence of sentences) {
      // If adding this sentence would exceed target size, finalize current chunk
      if (currentChunk.length + sentence.length > targetChunkSize && currentChunk.length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          index: chunkIndex++,
          startChar: currentIndex - currentChunk.length,
          endChar: currentIndex,
        });

        // Start new chunk with overlap
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + sentence;
      } else {
        currentChunk += sentence;
      }
      currentIndex += sentence.length;
    }

    // Add remaining chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        index: chunkIndex++,
        startChar: currentIndex - currentChunk.length,
        endChar: currentIndex,
      });
    }
  }

  return chunks;
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 characters)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

