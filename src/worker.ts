/**
 * Main Worker entry point
 * Routes requests to appropriate handlers
 */

import { handleUpload, handleDeleteFile, handleDebugChunks, handleCleanupOrphanedChunks } from "./ingestion";
import { retrieveChunks, formatChunksAsContext } from "./retrieval";
import { queryLLM } from "./llm";
import { ConversationMemory } from "./do/ConversationMemory";
import { FileRegistry } from "./do/FileRegistry";

export interface Env {
  AI: any;
  KV_EMBEDDINGS: KVNamespace;
  CONVERSATION_MEMORY: DurableObjectNamespace;
  FILE_REGISTRY: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // API routes
      if (path.startsWith("/api/")) {
        return handleAPIRequest(request, env, corsHeaders);
      }

      // Serve frontend (for local development)
      // In production, frontend should be deployed separately on Cloudflare Pages
      if (path === "/" || path.startsWith("/frontend/")) {
        return serveFrontend(path);
      }

      return new Response("Not found", { status: 404 });
    } catch (error: any) {
      console.error("Worker error:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Internal server error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  },
};

/**
 * Handle API requests
 */
async function handleAPIRequest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Upload endpoint
  if (path === "/api/upload" && request.method === "POST") {
    const response = await handleUpload(request, env);
    return addCorsHeaders(response, corsHeaders);
  }

  // Query endpoint
  if (path === "/api/query" && request.method === "POST") {
    const response = await handleQuery(request, env);
    return addCorsHeaders(response, corsHeaders);
  }

  // List files endpoint
  if (path === "/api/files" && request.method === "GET") {
    const response = await handleListFiles(env);
    return addCorsHeaders(response, corsHeaders);
  }

  // Get file endpoint
  if (path === "/api/files" && request.method === "GET") {
    const fileId = url.searchParams.get("fileId");
    if (fileId) {
      const response = await handleGetFile(fileId, env);
      return addCorsHeaders(response, corsHeaders);
    }
  }

  // Delete file endpoint
  if (path === "/api/files/delete" && request.method === "DELETE") {
    const response = await handleDeleteFile(request, env);
    return addCorsHeaders(response, corsHeaders);
  }

  // Debug endpoint to list all chunks (for debugging)
  if (path === "/api/debug/chunks" && request.method === "GET") {
    const response = await handleDebugChunks(env);
    return addCorsHeaders(response, corsHeaders);
  }

  // Admin endpoint to cleanup orphaned chunks
  if (path === "/api/admin/cleanup" && request.method === "POST") {
    const response = await handleCleanupOrphanedChunks(env);
    return addCorsHeaders(response, corsHeaders);
  }

  // Clear conversation endpoint
  if (path === "/api/conversation/clear" && request.method === "POST") {
    const response = await handleClearConversation(request, env);
    return addCorsHeaders(response, corsHeaders);
  }

  return new Response("Not found", { status: 404 });
}

/**
 * Handle query request
 */
async function handleQuery(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{
      query: string;
      sessionId: string;
    }>();

    if (!body.query || !body.sessionId) {
      return new Response(
        JSON.stringify({ error: "query and sessionId are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Retrieve relevant chunks
    const chunks = await retrieveChunks(body.query, env, 5);
    const context = formatChunksAsContext(chunks);

    // Query LLM with context
    const { answer, memoryState } = await queryLLM(
      body.query,
      context,
      body.sessionId,
      env
    );

    return new Response(
      JSON.stringify({
        answer,
        sources: chunks.map((chunk) => ({
          text: chunk.text.substring(0, 200) + "...",
          fileName: chunk.metadata?.fileName || "Unknown",
          score: chunk.score,
        })),
        memoryState,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Query error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Query failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Handle list files request
 */
async function handleListFiles(env: Env): Promise<Response> {
  try {
    const registryId = env.FILE_REGISTRY.idFromName("global");
    const registry = env.FILE_REGISTRY.get(registryId);

    const response = await registry.fetch(
      new Request("https://registry.internal/list", { method: "GET" })
    );

    return response;
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "Failed to list files" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Handle get file request
 */
async function handleGetFile(fileId: string, env: Env): Promise<Response> {
  try {
    const registryId = env.FILE_REGISTRY.idFromName("global");
    const registry = env.FILE_REGISTRY.get(registryId);

    const response = await registry.fetch(
      new Request(`https://registry.internal/get?fileId=${fileId}`, {
        method: "GET",
      })
    );

    return response;
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "Failed to get file" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Handle clear conversation request
 */
async function handleClearConversation(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json<{ sessionId: string }>();

    if (!body.sessionId) {
      return new Response(
        JSON.stringify({ error: "sessionId is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const memoryId = env.CONVERSATION_MEMORY.idFromName(body.sessionId);
    const memory = env.CONVERSATION_MEMORY.get(memoryId);

    const response = await memory.fetch(
      new Request("https://memory.internal/clear", { method: "POST" })
    );

    return response;
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "Failed to clear conversation" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(
  response: Response,
  corsHeaders: Record<string, string>
): Response {
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * Serve frontend (for development)
 */
function serveFrontend(path: string): Response {
  // In production, this should be handled by Cloudflare Pages
  // For development, we'll return a simple message
  return new Response(
    `
    <!DOCTYPE html>
    <html>
    <head>
      <title>ContextVault - Frontend</title>
      <meta charset="UTF-8">
    </head>
    <body>
      <h1>ContextVault Frontend</h1>
      <p>Please deploy the frontend to Cloudflare Pages or access it from the frontend directory.</p>
      <p>See README.md for deployment instructions.</p>
    </body>
    </html>
    `,
    { headers: { "Content-Type": "text/html" } }
  );
}

// Export Durable Object classes
export { ConversationMemory, FileRegistry };

