/**
 * Similarity scoring utilities for vector search
 */

/**
 * Compute cosine similarity between two vectors
 * Assumes vectors are already normalized
 */
export function cosineSimilarity(
  vec1: number[],
  vec2: number[]
): number {
  if (vec1.length !== vec2.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
  }

  return dotProduct; // Already normalized, so this is the cosine similarity
}

/**
 * Find top N most similar chunks
 */
export interface ScoredChunk {
  chunkKey: string;
  text: string;
  score: number;
  metadata?: any;
}

export function findTopChunks(
  queryEmbedding: number[],
  chunks: Array<{
    key: string;
    text: string;
    embedding: number[];
    metadata?: any;
  }>,
  topN: number = 5
): ScoredChunk[] {
  const scored: ScoredChunk[] = [];

  for (const chunk of chunks) {
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    scored.push({
      chunkKey: chunk.key,
      text: chunk.text,
      score,
      metadata: chunk.metadata,
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top N
  return scored.slice(0, topN);
}

