/**
 * Ingestion module: handles file upload, chunking, and embedding storage
 */

import type { Ai, KVNamespace, DurableObjectNamespace } from "@cloudflare/workers-types";
import { chunkText } from "./utils/chunk";
import { generateEmbedding, normalizeVector } from "./utils/embeddings";
import { extractPDFText, isPDF } from "./utils/pdf";
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
      
      // Check file size limits
      const maxFileSize = 10 * 1024 * 1024; // 10MB limit
      const recommendedSize = 2 * 1024 * 1024; // 2MB recommended
      
      if (file.size > maxFileSize) {
        return new Response(
          JSON.stringify({ 
            error: `File too large. Maximum size is ${Math.round(maxFileSize / 1024 / 1024)}MB, but file is ${Math.round(file.size / 1024 / 1024)}MB.`,
            details: "Please split large documents or use a smaller file."
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      
      if (file.size > recommendedSize) {
        console.warn(`Large file detected: ${fileName} (${Math.round(file.size / 1024 / 1024)}MB). Processing may be slow.`);
      }
      
      // Handle PDF files
      if (isPDF(fileType)) {
        try {
          const pdfBuffer = await file.arrayBuffer();
          
          // Add timeout protection for PDF processing
          const timeoutMs = 60000; // 60 seconds
          const extractionPromise = extractPDFText(pdfBuffer);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('PDF processing timeout - file too complex')), timeoutMs)
          );
          
          fileContent = await Promise.race([extractionPromise, timeoutPromise]) as string;
          fileType = "application/pdf";
          
          console.log(`Successfully extracted ${fileContent.length} characters from PDF: ${fileName}`);
          
          // Validate extracted content
          if (fileContent.length < 50) {
            throw new Error('PDF extraction produced very little text - may be image-based or corrupted');
          }
          
        } catch (error: any) {
          console.error(`PDF processing error for ${fileName}:`, error);
          
          // Provide more helpful error messages based on the type of error
          let errorMessage = `PDF processing failed: ${error.message}`;
          let details = "This PDF might be image-based, encrypted, or use unsupported compression.";
          
          if (error.message.includes('timeout')) {
            details = "The PDF is too complex or large to process. Try using a smaller or simpler PDF file.";
          } else if (error.message.includes('garbled')) {
            details = "The PDF content could not be properly decoded. This may be a scanned/image PDF or use unsupported encoding.";
          } else if (error.message.includes('very little text')) {
            details = "The PDF appears to contain mostly images or no readable text. Try using a text-based PDF instead.";
          }
          
          return new Response(
            JSON.stringify({ 
              error: errorMessage,
              details: details,
              suggestions: [
                "Try converting the PDF to a plain text file",
                "Use a smaller PDF file (under 2MB recommended)",
                "Ensure the PDF contains text (not just images)",
                "Try using a different PDF viewer to export as text"
              ]
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      } else {
        // Handle text files
        fileContent = await file.text();
        
        // Validate text file content
        if (!fileContent || fileContent.trim().length === 0) {
          return new Response(
            JSON.stringify({ error: "Text file is empty" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      }
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

/**
 * Handle file deletion request
 */
export async function handleDeleteFile(
  request: Request,
  env: IngestionEnv
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId");

    if (!fileId) {
      return new Response(
        JSON.stringify({ error: "fileId parameter is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get file registry
    const fileRegistryId = env.FILE_REGISTRY.idFromName("global");
    const fileRegistry = env.FILE_REGISTRY.get(fileRegistryId);

    // Get file metadata first to know how many chunks to delete
    const getResponse = await fileRegistry.fetch(
      new Request(`https://registry.internal/get?fileId=${fileId}`, {
        method: "GET",
      })
    );

    if (!getResponse.ok) {
      return new Response(
        JSON.stringify({ error: "File not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const fileData = await getResponse.json<{ file: any }>();
    const fileMetadata = fileData.file;

    // Delete all chunks from KV storage
    const chunkCount = fileMetadata.chunkCount || 0;
    console.log(`Deleting ${chunkCount} chunks for file ${fileId} (${fileMetadata.fileName})`);
    
    const deletePromises: Promise<void>[] = [];
    const deletedChunks: string[] = [];

    for (let i = 0; i < chunkCount; i++) {
      const chunkKey = `${fileId}:${i}`;
      deletedChunks.push(chunkKey);
      deletePromises.push(
        env.KV_EMBEDDINGS.delete(chunkKey).then(() => {
          console.log(`Deleted chunk: ${chunkKey}`);
        }).catch((error) => {
          console.error(`Failed to delete chunk ${chunkKey}:`, error);
          throw error;
        })
      );
    }

    // Wait for all chunk deletions to complete
    try {
      await Promise.all(deletePromises);
      console.log(`Successfully deleted all ${chunkCount} chunks for file ${fileId}`);
    } catch (error) {
      console.error(`Failed to delete some chunks for file ${fileId}:`, error);
      throw error;
    }

    // Delete from file registry
    const deleteResponse = await fileRegistry.fetch(
      new Request(`https://registry.internal/delete?fileId=${fileId}`, {
        method: "DELETE",
      })
    );

    if (!deleteResponse.ok) {
      console.error("Failed to delete from file registry:", await deleteResponse.text());
      return new Response(
        JSON.stringify({ error: "Failed to delete file from registry" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify deletion by trying to list remaining chunks for this file
    const keys = await env.KV_EMBEDDINGS.list({ prefix: `${fileId}:` });
    if (keys.keys.length > 0) {
      console.warn(`Warning: ${keys.keys.length} chunks still exist after deletion for file ${fileId}`);
      // Try to delete them again
      const retryDeletePromises = keys.keys.map(key => 
        env.KV_EMBEDDINGS.delete(key.name).then(() => {
          console.log(`Retry deleted chunk: ${key.name}`);
        })
      );
      await Promise.all(retryDeletePromises);
    }

    console.log(`Successfully deleted file ${fileId} and ${chunkCount} chunks`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully deleted file ${fileMetadata.fileName} and ${chunkCount} chunks`,
        fileId: fileId,
        deletedChunks: deletedChunks,
        verificationCheck: keys.keys.length === 0 ? 'passed' : `failed (${keys.keys.length} chunks remaining)`
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Delete error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Delete failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Cleanup orphaned chunks (chunks belonging to deleted files)
 */
export async function handleCleanupOrphanedChunks(env: IngestionEnv): Promise<Response> {
  try {
    // Get all chunks from KV
    const allChunks = await env.KV_EMBEDDINGS.list();
    
    // Get all registered files
    const fileRegistryId = env.FILE_REGISTRY.idFromName("global");
    const fileRegistry = env.FILE_REGISTRY.get(fileRegistryId);
    
    const filesResponse = await fileRegistry.fetch(
      new Request("https://registry.internal/list", { method: "GET" })
    );
    
    if (!filesResponse.ok) {
      throw new Error("Failed to get file registry");
    }
    
    const filesData = await filesResponse.json<{ files: any[] }>();
    const registeredFileIds = new Set(filesData.files.map(f => f.fileId));
    
    // Find orphaned chunks
    const orphanedChunks: string[] = [];
    const chunksByFile: { [fileId: string]: string[] } = {};
    
    allChunks.keys.forEach(key => {
      const parts = key.name.split(':');
      if (parts.length >= 2) {
        const fileId = parts[0];
        
        if (!chunksByFile[fileId]) {
          chunksByFile[fileId] = [];
        }
        chunksByFile[fileId].push(key.name);
        
        // If this file ID is not in the registry, it's orphaned
        if (!registeredFileIds.has(fileId)) {
          orphanedChunks.push(key.name);
        }
      }
    });
    
    console.log(`Found ${orphanedChunks.length} orphaned chunks from ${Object.keys(chunksByFile).filter(fId => !registeredFileIds.has(fId)).length} deleted files`);
    
    // Delete orphaned chunks
    if (orphanedChunks.length > 0) {
      const deletePromises = orphanedChunks.map(chunkKey =>
        env.KV_EMBEDDINGS.delete(chunkKey).then(() => {
          console.log(`Cleaned up orphaned chunk: ${chunkKey}`);
        }).catch((error) => {
          console.error(`Failed to delete orphaned chunk ${chunkKey}:`, error);
          throw error;
        })
      );
      
      await Promise.all(deletePromises);
      console.log(`Successfully cleaned up ${orphanedChunks.length} orphaned chunks`);
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        totalChunksScanned: allChunks.keys.length,
        registeredFiles: filesData.files.length,
        orphanedChunksFound: orphanedChunks.length,
        orphanedChunksDeleted: orphanedChunks.length,
        remainingChunks: allChunks.keys.length - orphanedChunks.length,
        message: orphanedChunks.length > 0 
          ? `Cleaned up ${orphanedChunks.length} orphaned chunks` 
          : "No orphaned chunks found"
      }, null, 2),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Cleanup error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Cleanup failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Debug function to list all chunks in KV storage
 */
export async function handleDebugChunks(env: IngestionEnv): Promise<Response> {
  try {
    const keys = await env.KV_EMBEDDINGS.list();
    
    const chunksByFile: { [fileId: string]: string[] } = {};
    
    keys.keys.forEach(key => {
      const parts = key.name.split(':');
      if (parts.length >= 2) {
        const fileId = parts[0];
        if (!chunksByFile[fileId]) {
          chunksByFile[fileId] = [];
        }
        chunksByFile[fileId].push(key.name);
      }
    });

    return new Response(
      JSON.stringify({
        totalChunks: keys.keys.length,
        chunksByFile: chunksByFile,
        allChunkKeys: keys.keys.map(k => k.name)
      }, null, 2),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "Debug failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

