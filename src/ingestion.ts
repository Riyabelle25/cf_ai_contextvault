/**
 * Ingestion module: handles file upload, chunking, and embedding storage
 */

import type { Ai, KVNamespace, DurableObjectNamespace } from "@cloudflare/workers-types";
import { chunkText } from "./utils/chunk";
import { generateEmbedding, normalizeVector } from "./utils/embeddings";
import type { FileRegistry } from "./do/FileRegistry";

export interface IngestionEnv {
  AI: Ai;
  KV_EMBEDDINGS: KVNamespace;
  FILE_REGISTRY: DurableObjectNamespace;
}

/**
 * Process and ingest a file
 */
export async function ingestFile(
  fileContent: string,
  fileName: string,
  fileType: string,
  env: IngestionEnv
): Promise<{ fileId: string; chunkCount: number }> {
  // Register file in FileRegistry
  const fileRegistryId = env.FILE_REGISTRY.idFromName("global");
  const fileRegistry = env.FILE_REGISTRY.get(fileRegistryId);

  const registerResponse = await fileRegistry.fetch(
    new Request("https://registry.internal/register", {
      method: "POST",
      body: JSON.stringify({
        fileName,
        fileType,
        totalSize: fileContent.length,
      }),
      headers: { "Content-Type": "application/json" },
    })
  );

  const { fileId } = await registerResponse.json<{ fileId: string }>();

  // Chunk the text
  const chunks = chunkText(fileContent, 500, 50);

  // Process each chunk: generate embedding and store
  let processedCount = 0;
  const errors: string[] = [];

  for (const chunk of chunks) {
    try {
      // Generate embedding
      const embedding = await generateEmbedding(env.AI, chunk.text);
      const normalizedEmbedding = normalizeVector(embedding);

      // Store in KV
      const chunkKey = `${fileId}:${chunk.index}`;
      const chunkData = {
        text: chunk.text,
        embedding: normalizedEmbedding,
        metadata: {
          fileName,
          fileType,
          chunkIndex: chunk.index,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
        },
      };

      await env.KV_EMBEDDINGS.put(chunkKey, JSON.stringify(chunkData));
      processedCount++;
    } catch (error: any) {
      errors.push(`Chunk ${chunk.index}: ${error.message}`);
    }
  }

  // Update file registry with completion status
  const updateResponse = await fileRegistry.fetch(
    new Request("https://registry.internal/update", {
      method: "POST",
      body: JSON.stringify({
        fileId,
        updates: {
          chunkCount: processedCount,
          status: errors.length > 0 ? "error" : "completed",
          error: errors.length > 0 ? errors.join("; ") : undefined,
        },
      }),
      headers: { "Content-Type": "application/json" },
    })
  );

  if (!updateResponse.ok) {
    console.error("Failed to update file registry:", await updateResponse.text());
  }

  return { fileId, chunkCount: processedCount };
}

/**
 * Handle file upload request
 */
export async function handleUpload(
  request: Request,
  env: IngestionEnv
): Promise<Response> {
  try {
    // Parse multipart form data or JSON
    const contentType = request.headers.get("content-type") || "";

    let fileContent: string;
    let fileName: string;
    let fileType: string;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const fileEntry = formData.get("file");
      
      if (!fileEntry) {
        return new Response(
          JSON.stringify({ error: "No file provided" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Check if it's a File object
      if (typeof fileEntry === "string") {
        return new Response(
          JSON.stringify({ error: "File upload must be a file, not text" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const file = fileEntry as File;
      fileName = file.name;
      fileType = file.type || "text/plain";
      fileContent = await file.text();
    } else if (contentType.includes("application/json")) {
      const body = await request.json<{
        content: string;
        fileName?: string;
        fileType?: string;
      }>();

      fileContent = body.content;
      fileName = body.fileName || "pasted_text.txt";
      fileType = body.fileType || "text/plain";
    } else {
      // Try to read as plain text
      fileContent = await request.text();
      fileName = "pasted_text.txt";
      fileType = "text/plain";
    }

    if (!fileContent || fileContent.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "File content is empty" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Process the file
    const result = await ingestFile(fileContent, fileName, fileType, env);

    return new Response(
      JSON.stringify({
        success: true,
        fileId: result.fileId,
        chunkCount: result.chunkCount,
        message: `Successfully processed ${result.chunkCount} chunks`,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Upload error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Upload failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

