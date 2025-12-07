# Prompt Used in while developing ContextVault

# **Cursor IDE Prompt - Build “ContextVault” (Cloudflare AI RAG App)**

**You are an expert full-stack engineer helping me build an AI-powered application on Cloudflare called *ContextVault*.
Follow Cloudflare’s internship assignment requirements strictly.
Generate code, config files, and instructions as needed.
The tech stack is: Cloudflare Workers, Workers AI (Llama 3.3), Cloudflare KV, Cloudflare Durable Objects, Cloudflare Pages (frontend), Cloudflare Workflows (optional), and Realtime (optional).**

---

## **PROJECT OVERVIEW**

Build **ContextVault**, a simple Retrieval-Augmented Generation (RAG) application that:

1. Lets the user upload or paste a *knowledge directory* (study notes, lecture dumps, markdown docs, or codebase files).
2. Stores processed embeddings and metadata in **Cloudflare KV** and **Durable Objects** (for conversation memory + file registry).
3. Provides a **chat UI** on Cloudflare Pages that:

   * accepts questions
   * queries Workers AI embeddings
   * retrieves relevant chunks
   * calls Llama 3.3 for final answers
4. Maintains **conversation memory** via a Conversation Durable Object.
5. Includes:

   * a README.md with usage + deployment instructions
   * PROMPTS.md containing all prompts used
   * Repository name: `cf_ai_contextvault`

This must be **simple**, minimal config, deployable without complex billing setup.

---

## **CORE FEATURES TO IMPLEMENT**

### **1. Ingestion Workflow**

* Frontend upload (drag/drop or paste text).
* Send files to a Worker endpoint `/api/upload`.
* Split text into manageable chunks (e.g., 500–1000 tokens).
* Generate embeddings with:

  ```ts
  const embedding = await ai.run("@cf/baai/bge-large-en-v1.5", { text });
  ```
* Store:

  * embeddings in KV (chunk → embedding JSON)
  * metadata registry in a Durable Object

### **2. Retrieval Flow**

For queries:

* Embed the user query via Workers AI.
* Compute cosine similarity against stored embeddings.
* Return top N chunks.
* Pass chunks + query + conversation memory into Llama 3.3:

  ```ts
  await ai.run("@cf/meta/llama-3.3-70b-instruct", { prompt, ... })
  ```

### **3. Conversation Memory**

Use a Durable Object:

* Stores last ~10 dialogue turns
* Each new answer updates the state
* State is appended to the RAG prompt

### **4. Chat Interface**

* Implement simple Cloudflare Pages app using:

  * HTML + Tailwind OR React (your choice)
  * WebSockets or Cloudflare Realtime (optional but preferred for live streaming)
* Show:

  * message bubbles
  * context sources (show retrieved chunks)
  * file ingestion status

### **5. Deployment**

* Create Cloudflare `wrangler.toml`
* Provide clear deploy steps for:

  ```
  npm install
  wrangler dev
  wrangler deploy
  ```

---

## **CODE STRUCTURE (Generate this in the repo)**

```
cf_ai_contextvault/
│
├── README.md
├── PROMPTS.md
├── wrangler.toml
├── package.json
│
├── src/
│   ├── worker.ts               # Main Worker router
│   ├── ingestion.ts            # File upload + chunking + embedding
│   ├── retrieval.ts            # Embedding search + scoring
│   ├── llm.ts                  # Workers AI Llama calls
│   ├── do/ConversationMemory.ts
│   ├── do/FileRegistry.ts
│   └── utils/
│       ├── chunk.ts
│       ├── embeddings.ts
│       └── scoring.ts
│
└── frontend/                   # Cloudflare Pages site
    ├── index.html or src/
    ├── chat.js / chat.tsx
    └── styles.css
```

---

## **FUNCTIONAL REQUIREMENTS**

Cursor should generate code that supports:

### **Uploading files**

* Endpoint: POST `/api/upload`
* Accept text/markdown and code file types
* Chunk + embed + store

### **Querying**

* Endpoint: POST `/api/query`
* Body: `{ query: string, sessionId: string }`
* Return: `{ answer, sources, memoryState }`

### **Conversation memory**

* Durable Object name: `ConversationMemory`
* Methods: `getState()`, `appendTurn()`

### **Embedding store**

* KV namespace: `KV_EMBEDDINGS`
* Key: `${fileId}:${chunkIndex}`
* Value: `{ text, embedding }`

### **User interface**

* Form for upload
* Chat box
* Sidebar listing uploaded files
* Visual UI not required to be fancy - just functional

---

## **NON-FUNCTIONAL REQUIREMENTS**

* Minimal dependencies (pure Workers preferred)
* Fully edge-native
* No backend server
* Fully deployable on free-tier Cloudflare

---

## **DOCUMENTATION REQUIREMENTS**

Cursor should generate:

### **README.md**

* Project overview
* How to run locally
* How to deploy with Wrangler
* Screenshots (optional placeholders)
* Architecture diagram (ASCII okay)

---

## **FINAL TASK FOR CURSOR**

Ensure code compiles and deploys with Wrangler.
Write clear comments and helper scripts where necessary.

---