/**
 * Durable Object for managing conversation memory
 * Stores the last N dialogue turns for context in RAG queries
 */

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ConversationState {
  turns: ConversationTurn[];
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}

export class ConversationMemory {
  private state: DurableObjectState;
  private env: any;
  private storage: DurableObjectStorage;

  // Maximum number of turns to keep in memory
  private readonly MAX_TURNS = 10;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/state") {
        return this.getState();
      } else if (request.method === "POST" && path === "/append") {
        return this.appendTurn(request);
      } else if (request.method === "POST" && path === "/clear") {
        return this.clear();
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
   * Get current conversation state
   */
  private async getState(): Promise<Response> {
    const state = await this.storage.get<ConversationState>("state");
    
    if (!state) {
      return new Response(
        JSON.stringify({
          turns: [],
          sessionId: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(state), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Append a new turn to the conversation
   */
  private async appendTurn(request: Request): Promise<Response> {
    const body = await request.json<{
      role: "user" | "assistant";
      content: string;
      sessionId?: string;
    }>();

    let state = await this.storage.get<ConversationState>("state");

    if (!state) {
      state = {
        turns: [],
        sessionId: body.sessionId || "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // Add new turn
    state.turns.push({
      role: body.role,
      content: body.content,
      timestamp: Date.now(),
    });

    // Keep only the last MAX_TURNS
    if (state.turns.length > this.MAX_TURNS) {
      state.turns = state.turns.slice(-this.MAX_TURNS);
    }

    state.updatedAt = Date.now();
    if (body.sessionId) {
      state.sessionId = body.sessionId;
    }

    await this.storage.put("state", state);

    return new Response(JSON.stringify(state), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Clear conversation history
   */
  private async clear(): Promise<Response> {
    await this.storage.delete("state");
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * Format conversation history as a string for LLM context
   */
  static formatHistory(turns: ConversationTurn[]): string {
    return turns
      .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
      .join("\n\n");
  }
}

