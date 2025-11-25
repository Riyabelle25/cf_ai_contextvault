/**
 * Durable Object for managing file registry
 * Tracks uploaded files and their metadata
 */

export interface FileMetadata {
  fileId: string;
  fileName: string;
  fileType: string;
  uploadedAt: number;
  chunkCount: number;
  totalSize: number;
  status: "processing" | "completed" | "error";
  error?: string;
}

export interface RegistryState {
  files: Map<string, FileMetadata>;
  lastFileId: number;
}

export class FileRegistry {
  private state: DurableObjectState;
  private env: any;
  private storage: DurableObjectStorage;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/list") {
        return this.listFiles();
      } else if (request.method === "GET" && path === "/get") {
        return this.getFile(request);
      } else if (request.method === "POST" && path === "/register") {
        return this.registerFile(request);
      } else if (request.method === "POST" && path === "/update") {
        return this.updateFile(request);
      } else if (request.method === "DELETE" && path === "/delete") {
        return this.deleteFile(request);
      } else {
        return new Response("Not found", { status: 404 });
      }
    } catch (error: any) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  /**
   * List all registered files
   */
  private async listFiles(): Promise<Response> {
    const state = await this.getState();
    const files = Array.from(state.files.values());
    
    return new Response(JSON.stringify({ files }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Get file metadata by ID
   */
  private async getFile(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId");

    if (!fileId) {
      return new Response(
        JSON.stringify({ error: "fileId is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const state = await this.getState();
    const file = state.files.get(fileId);

    if (!file) {
      return new Response(
        JSON.stringify({ error: "File not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ file }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Register a new file
   */
  private async registerFile(request: Request): Promise<Response> {
    const body = await request.json<{
      fileName: string;
      fileType: string;
      totalSize: number;
    }>();

    const state = await this.getState();
    const fileId = `file_${++state.lastFileId}_${Date.now()}`;

    const metadata: FileMetadata = {
      fileId,
      fileName: body.fileName,
      fileType: body.fileType,
      uploadedAt: Date.now(),
      chunkCount: 0,
      totalSize: body.totalSize,
      status: "processing",
    };

    state.files.set(fileId, metadata);
    await this.saveState(state);

    return new Response(JSON.stringify({ fileId, metadata }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Update file metadata
   */
  private async updateFile(request: Request): Promise<Response> {
    const body = await request.json<{
      fileId: string;
      updates: Partial<FileMetadata>;
    }>();

    const state = await this.getState();
    const file = state.files.get(body.fileId);

    if (!file) {
      return new Response(
        JSON.stringify({ error: "File not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    Object.assign(file, body.updates);
    state.files.set(body.fileId, file);
    await this.saveState(state);

    return new Response(JSON.stringify({ file }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Delete a file from registry
   */
  private async deleteFile(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId");

    if (!fileId) {
      return new Response(
        JSON.stringify({ error: "fileId is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const state = await this.getState();
    state.files.delete(fileId);
    await this.saveState(state);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * Get current state from storage
   */
  private async getState(): Promise<RegistryState> {
    const stored = await this.storage.get<{
      files: Array<[string, FileMetadata]>;
      lastFileId: number;
    }>("state");
    
    if (!stored) {
      return {
        files: new Map(),
        lastFileId: 0,
      };
    }

    // Convert files array back to Map
    const state: RegistryState = {
      files: new Map(stored.files || []),
      lastFileId: stored.lastFileId || 0,
    };

    return state;
  }

  /**
   * Save state to storage (convert Map to array for serialization)
   */
  private async saveState(state: RegistryState): Promise<void> {
    const serializable = {
      files: Array.from(state.files.entries()),
      lastFileId: state.lastFileId,
    };
    await this.storage.put("state", serializable);
  }
}

