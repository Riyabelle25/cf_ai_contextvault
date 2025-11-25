/**
 * Embedding utilities for generating and working with vector embeddings
 */

import type { Ai } from "@cloudflare/workers-types";

/**
 * Generate embedding for text using Workers AI
 */
export async function generateEmbedding(
  ai: Ai,
  text: string
): Promise<number[]> {
  const response = await ai.run("@cf/baai/bge-large-en-v1.5", {
    text: text.trim(),
  });

  // The response should be an array of numbers (embedding vector)
  if (Array.isArray(response)) {
    return response as number[];
  }

  // Handle different response formats
  if (response && typeof response === "object" && "data" in response) {
    return (response as any).data as number[];
  }

  throw new Error("Unexpected embedding response format");
}

/**
 * Normalize a vector to unit length
 */
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((sum, val) => sum + val * val, 0)
  );
  if (magnitude === 0) return vector;
  return vector.map((val) => val / magnitude);
}

