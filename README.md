# ContextVault

**ContextVault** is a Retrieval-Augmented Generation (RAG) application built on Cloudflare Workers, Workers AI, KV, and Durable Objects. It lets users to upload knowledge base documents and chat with an AI assistant that answers questions based on the uploaded content.

## Features

- 📄 **File Upload**: Upload text files, markdown documents, or paste text directly
- 🔍 **Semantic Search**: Uses Workers AI embeddings for intelligent document retrieval
- 💬 **AI Chat**: Powered by Llama 3.3 70B for natural language responses
- 🧠 **Conversation Memory**: Maintains context across multiple turns using Durable Objects
- 📚 **File Registry**: Tracks all uploaded files and their processing status
- 🎨 **Modern UI**: Clean, responsive interface built with Tailwind CSS

## Architecture

```
┌─────────────┐
│   Frontend  │  (Cloudflare Pages)
│  (HTML/JS)  │
└──────┬──────┘
       │
       ▼
┌───────────────────────────────────────┐
│         Cloudflare Worker             │
│  ┌──────────────────────────────────┐ │
│  │  API Routes                      │ │
│  │  - /api/upload                   │ │
│  │  - /api/query                    │ │
│  │  - /api/files                    │ │
│  └──────────────────────────────────┘ │
│                                       │
│  ┌──────────┐  ┌──────────┐           │
│  │Ingestion │  │Retrieval │  ┌─────┐  │
│  │ Module   │  │ Module   │  │ LLM │  │
│  └──────────┘  └──────────┘  └─────┘  │
└──────┬──────────────┬──────────┬──────┘
       │              │          │
       ▼              ▼          ▼
┌─────────────┐ ┌─────────────┐ ┌──────────────┐
│  KV Store   │ │ Durable Obj │ │ Workers AI   │
│ (Embeddings)│ │ (Memory &   │ │ (Embeddings  │
│             │ │  Registry)  │ │  & Llama)    │
└─────────────┘ └─────────────┘ └──────────────┘
```

## Tech Stack

- **Cloudflare Workers**: Serverless runtime for API endpoints
- **Workers AI**: 
  - `@cf/baai/bge-large-en-v1.5` for embeddings
  - `@cf/meta/llama-3.3-70b-instruct` for LLM responses
- **Cloudflare KV**: Storage for document embeddings
- **Durable Objects**: 
  - `ConversationMemory`: Manages chat history
  - `FileRegistry`: Tracks uploaded files
- **Cloudflare Pages**: Frontend hosting

## Prerequisites

- Node.js 18+ and npm
- Cloudflare account with Workers AI enabled
- Wrangler CLI installed globally: `npm install -g wrangler`

## Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd cf_ai_contextvault
npm install
```

### 2. Configure Wrangler

Login to Cloudflare:

```bash
wrangler login
```

### 3. Create KV Namespace

Create a KV namespace for embeddings:

```bash
wrangler kv:namespace create "KV_EMBEDDINGS"
wrangler kv:namespace create "KV_EMBEDDINGS" --preview
```

Update `wrangler.toml` with the returned namespace IDs:

```toml
[[kv_namespaces]]
binding = "KV_EMBEDDINGS"
id = "your_production_namespace_id"
preview_id = "your_preview_namespace_id"
```

### 4. Deploy Durable Objects

The Durable Objects will be created automatically on first deploy. Make sure your `wrangler.toml` includes the migration:

```toml
[[migrations]]
tag = "v1"
new_classes = ["ConversationMemory", "FileRegistry"]
```

### 5. Deploy Worker

```bash
npm run deploy
```

Or for development:

```bash
npm run dev
```

The worker will be available at `http://localhost:8787` in development.

### 6. Deploy Frontend

#### Option A: Cloudflare Pages (Recommended)

1. Push your code to a Git repository
2. Go to Cloudflare Dashboard → Pages
3. Create a new project and connect your repository
4. Set build settings:
   - Build command: (none needed, static files)
   - Build output directory: `frontend`
   - Root directory: (leave empty)

#### Option B: Serve Locally

For local development, you can serve the frontend using any static file server:

```bash
cd frontend
python3 -m http.server 8000
# or
npx serve .
```

Then update `frontend/chat.js` to point to your Worker URL:

```javascript
const API_BASE_URL = 'http://localhost:8787'; // or your Worker URL
```

## Usage

### 1. Upload Documents

- **File Upload**: Click "Upload File" and select a text file
- **Paste Text**: Paste content directly into the text area and click "Submit Text"

Supported file types: `.txt`, `.md`, `.json`, `.js`, `.ts`, `.py`, `.html`, `.css`

### 2. Ask Questions

Once documents are uploaded, type questions in the chat interface. The AI will:

1. Generate an embedding for your question
2. Find the most relevant document chunks
3. Use those chunks as context to generate an answer
4. Display the answer along with source citations

### 3. Conversation Memory

The chat maintains context across multiple turns. The last 10 conversation turns are kept in memory to provide better context-aware responses.

## API Endpoints

### POST `/api/upload`

Upload a file or paste text.

**Request (multipart/form-data):**
```
file: <file>
```

**Request (JSON):**
```json
{
  "content": "text content",
  "fileName": "example.txt",
  "fileType": "text/plain"
}
```

**Response:**
```json
{
  "success": true,
  "fileId": "file_1_1234567890",
  "chunkCount": 5,
  "message": "Successfully processed 5 chunks"
}
```

### POST `/api/query`

Query the knowledge base.

**Request:**
```json
{
  "query": "What is the main topic?",
  "sessionId": "session_1234567890"
}
```

**Response:**
```json
{
  "answer": "The main topic is...",
  "sources": [
    {
      "text": "chunk preview...",
      "fileName": "example.txt",
      "score": 0.85
    }
  ],
  "memoryState": { ... }
}
```

### GET `/api/files`

List all uploaded files.

**Response:**
```json
{
  "files": [
    {
      "fileId": "file_1_1234567890",
      "fileName": "example.txt",
      "fileType": "text/plain",
      "uploadedAt": 1234567890,
      "chunkCount": 5,
      "status": "completed"
    }
  ]
}
```

### POST `/api/conversation/clear`

Clear conversation history.

**Request:**
```json
{
  "sessionId": "session_1234567890"
}
```

## Project Structure

```
cf_ai_contextvault/
├── README.md
├── PROMPTS.md
├── wrangler.toml
├── package.json
├── tsconfig.json
├── src/
│   ├── worker.ts              # Main Worker router
│   ├── ingestion.ts           # File upload & processing
│   ├── retrieval.ts           # Embedding search
│   ├── llm.ts                 # Llama 3.3 integration
│   ├── do/
│   │   ├── ConversationMemory.ts
│   │   └── FileRegistry.ts
│   └── utils/
│       ├── chunk.ts
│       ├── embeddings.ts
│       └── scoring.ts
└── frontend/
    ├── index.html
    ├── chat.js
    └── styles.css
```

## Development

### Local Development

```bash
# Start development server
npm run dev

# Type check
npm run typecheck
```

### Testing

1. Start the worker: `npm run dev`
2. Open the frontend in a browser
3. Upload a test document
4. Ask questions about the document

## Limitations & Notes

- **KV Limitations**: Cloudflare KV doesn't support efficient vector search. This implementation fetches all chunks for similarity search, which may be slow with large document sets. For production use with many documents, consider using a dedicated vector database.

- **Embedding Model**: Uses `bge-large-en-v1.5` which supports English text. For other languages, you may need to use a different embedding model.

- **Chunk Size**: Default chunk size is 500 characters with 50 character overlap. Adjust in `src/utils/chunk.ts` if needed.

- **Memory Limit**: Conversation memory is limited to the last 10 turns. Adjust `MAX_TURNS` in `ConversationMemory.ts` if needed.

## Troubleshooting

### Worker fails to deploy

- Ensure you're logged in: `wrangler login`
- Check that KV namespaces are created and IDs are correct in `wrangler.toml`
- Verify Workers AI is enabled in your Cloudflare account

### Embeddings not working

- Ensure Workers AI is enabled in your Cloudflare dashboard
- Check that the embedding model name is correct: `@cf/baai/bge-large-en-v1.5`

### Frontend can't connect to API

- Update `API_BASE_URL` in `frontend/chat.js` to match your Worker URL
- Check CORS headers are properly set (they should be in the worker code)

## License

MIT

## Contributing

This is a Cloudflare internship assignment project.

