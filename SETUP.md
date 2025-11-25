# Quick Setup Guide

This is a condensed setup guide. For detailed instructions, see [README.md](./README.md).

## Prerequisites

1. Node.js 18+ installed
2. Cloudflare account with Workers AI enabled
3. Wrangler CLI: `npm install -g wrangler`

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Create KV Namespace

```bash
# Create production namespace
wrangler kv:namespace create "KV_EMBEDDINGS"

# Create preview namespace  
wrangler kv:namespace create "KV_EMBEDDINGS" --preview
```

Copy the returned IDs and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV_EMBEDDINGS"
id = "paste_production_id_here"
preview_id = "paste_preview_id_here"
```

### 4. Deploy Worker

```bash
npm run deploy
```

The first deployment will create the Durable Objects automatically.

### 5. Deploy Frontend

#### Option A: Cloudflare Pages (Recommended)

1. Push code to GitHub/GitLab
2. Go to Cloudflare Dashboard → Pages → Create a project
3. Connect your repository
4. Build settings:
   - **Build command**: (leave empty)
   - **Build output directory**: `frontend`
   - **Root directory**: (leave empty)
5. Deploy

#### Option B: Local Development

```bash
cd frontend
# Update API_BASE_URL in chat.js to your Worker URL
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

### 6. Configure Frontend API URL

If your frontend and worker are on different domains, update `frontend/chat.js`:

```javascript
API_BASE_URL = 'https://contextvault.your-subdomain.workers.dev';
```

## Verify Setup

1. Open your frontend URL
2. Upload a test file or paste some text
3. Ask a question about the uploaded content
4. You should receive an AI-generated answer with source citations

## Troubleshooting

### "Workers AI not enabled"
- Go to Cloudflare Dashboard → Workers & Pages → AI
- Enable Workers AI for your account

### "KV namespace not found"
- Verify the namespace IDs in `wrangler.toml` are correct
- Re-run `wrangler kv:namespace create` if needed

### "Durable Objects migration failed"
- Ensure the migration tag in `wrangler.toml` matches your deployment
- Try deleting and recreating the Durable Objects

### Frontend can't connect to API
- Check CORS is enabled (should be in worker code)
- Verify `API_BASE_URL` in `frontend/chat.js` matches your Worker URL
- Check browser console for errors

## Next Steps

- Read [README.md](./README.md) for detailed documentation
- Check [PROMPTS.md](./PROMPTS.md) for prompt engineering details
- Customize chunk sizes, memory limits, and other parameters as needed

