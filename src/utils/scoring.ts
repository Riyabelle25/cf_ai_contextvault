/**
 * Similarity scoring utilities for vector s  for (const chunk of chunks) {
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    // Ensure score is a valid number
    const validScore = (typeof score === 'number' && !isNaN(score)) ? score : 0;
    scored.push({
      chunkKey: chunk.key,
      text: chunk.text,
      score: validScore,
      metadata: chunk.metadata,
    });
  }

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

  // Ensure we return a valid number, defaulting to 0 if NaN
  const similarity = dotProduct;
  return isNaN(similarity) ? 0 : similarity;
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

