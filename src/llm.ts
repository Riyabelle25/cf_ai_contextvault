/**
 * LLM module: handles calls to Workers AI (Llama 3.3)
 */

import type { Ai } from "@cloudflare/workers-types";
import type { ConversationTurn } from "./do/ConversationMemory";
import { ConversationMemory } from "./do/ConversationMemory";

export interface LLMEnv {
  AI: Ai;
  CONVERSATION_MEMORY: DurableObjectNamespace;
}

/**
 * Generate RAG prompt with context and conversation history
 */
function buildRAGPrompt(
  query: string,
  context: string,
  conversationHistory: string
): string {
  const systemPrompt = `You are a helpful AI assistant that answers questions based on the provided context documents. 
Use the context information to provide accurate and relevant answers. If the context doesn't contain enough information to answer the question, say so honestly.

Previous conversation history:
${conversationHistory || "No previous conversation."}

Context documents:
${context}

User question: ${query}

Please provide a helpful answer based on the context above. If relevant, cite which source(s) you used.`;

  return systemPrompt;
}

/**
 * Query Llama 3.3 with RAG context
 */
export async function queryLLM(
  query: string,
  context: string,
  sessionId: string,
  env: LLMEnv
): Promise<{ answer: string; memoryState: any }> {
  // Get conversation history
  const memoryId = env.CONVERSATION_MEMORY.idFromName(sessionId);
  const memory = env.CONVERSATION_MEMORY.get(memoryId);

  const historyResponse = await memory.fetch(
    new Request("https://memory.internal/state", { method: "GET" })
  );
  const historyState = await historyResponse.json<{
    turns: ConversationTurn[];
  }>();

  const conversationHistory = ConversationMemory.formatHistory(
    historyState.turns || []
  );

  // Build prompt
  const prompt = buildRAGPrompt(query, context, conversationHistory);

  // Call Llama 3.3
  // Note: Using type assertion as the model may not be in type definitions yet
  const response = await (env.AI as any).run("@cf/meta/llama-3.1-70b-instruct", {
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1000,
    temperature: 0.7,
  });

  // Extract answer from response
  let answer: string;
  if (typeof response === "string") {
    answer = response;
  } else if (response && typeof response === "object") {
    // Handle chat completion response format
    if ("choices" in response && response.choices && response.choices.length > 0) {
      const choice = response.choices[0];
      if (choice.message && choice.message.content) {
        answer = choice.message.content;
      } else {
        answer = choice.text || "No response generated.";
      }
    } else if ("response" in response) {
      answer = (response as any).response;
    } else if ("text" in response) {
      answer = (response as any).text;
    } else if ("description" in response) {
      answer = (response as any).description;
    } else {
      answer = JSON.stringify(response);
    }
  } else {
    answer = "I apologize, but I couldn't generate a response.";
  }

  // Update conversation memory
  // Add user query
  await memory.fetch(
    new Request("https://memory.internal/append", {
      method: "POST",
      body: JSON.stringify({
        role: "user",
        content: query,
        sessionId,
      }),
      headers: { "Content-Type": "application/json" },
    })
  );

  // Add assistant response
  const memoryUpdateResponse = await memory.fetch(
    new Request("https://memory.internal/append", {
      method: "POST",
      body: JSON.stringify({
        role: "assistant",
        content: answer,
        sessionId,
      }),
      headers: { "Content-Type": "application/json" },
    })
  );

  const updatedMemoryState = await memoryUpdateResponse.json();

  return {
    answer: answer.trim(),
    memoryState: updatedMemoryState,
  };
}

