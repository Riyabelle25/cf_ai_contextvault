/**
 * Retrieval module: handles embedding search and similarity scoring
 */

import type { Ai, KVNamespace } from "@cloudflare/workers-types";
import { generateEmbedding, normalizeVector } from "./utils/embeddings";
import { findTopChunks, type ScoredChunk } from "./utils/scoring";

export interface RetrievalEnv {
  AI: Ai;
  KV_EMBEDDINGS: KVNamespace;
}

export interface ChunkData {
  text: string;
  embedding: number[];
  metadata?: {
    fileName: string;
    fileType: string;
    chunkIndex: number;
    startChar?: number;
    endChar?: number;
  };
}

/**
 * Retrieve relevant chunks for a query
 */
export async function retrieveChunks(
  query: string,
  env: RetrievalEnv,
  topN: number = 5
): Promise<ScoredChunk[]> {
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(env.AI, query);
  const normalizedQueryEmbedding = normalizeVector(queryEmbedding);

  // Get all chunks from KV
  // Note: In production, you'd want to use a vector database or index
  // For simplicity, we'll list all keys and fetch chunks
  const chunks: Array<{
    key: string;
    text: string;
    embedding: number[];
    metadata?: any;
  }> = [];

  // List all keys (this is a simplified approach - in production use a proper index)
  // For now, we'll need to track file IDs separately or use a different approach
  // This is a limitation of KV - it doesn't support efficient vector search
  // In a real implementation, you'd use a vector database or maintain an index
  
  // For this demo, we'll fetch chunks by pattern
  // In practice, you'd maintain a list of file IDs and iterate through them
  const keys = await env.KV_EMBEDDINGS.list();
  
  // Fetch chunks in batches
  const batchSize = 100;
  for (let i = 0; i < keys.keys.length; i += batchSize) {
    const batch = keys.keys.slice(i, i + batchSize);
    const values = await Promise.all(
      batch.map((key) => env.KV_EMBEDDINGS.get(key.name, "json"))
    );

    for (let j = 0; j < batch.length; j++) {
      const chunkData = values[j] as ChunkData | null;
      if (chunkData && chunkData.embedding) {
        chunks.push({
          key: batch[j].name,
          text: chunkData.text,
          embedding: chunkData.embedding,
          metadata: chunkData.metadata,
        });
      }
    }
  }

  // Find top N most similar chunks
  const topChunks = findTopChunks(normalizedQueryEmbedding, chunks, topN);

  return topChunks;
}

/**
 * Format retrieved chunks as context for LLM
 */
export function formatChunksAsContext(chunks: ScoredChunk[]): string {
  return chunks
    .map((chunk, idx) => {
      const source = chunk.metadata?.fileName || "Unknown";
      return `[Source ${idx + 1}: ${source}]\n${chunk.text}`;
    })
    .join("\n\n---\n\n");
}

