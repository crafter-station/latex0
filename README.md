<p align="center">
  <img src="public/og.png" alt="LATEX0" width="100%" />
</p>

<h1 align="center">
  LATEX0
</h1>

<p align="center">
  The Future of Typesetting
  <br />
  <br />
  <a href="https://latex0.crafter.run">Website</a>
  ·
  <a href="https://github.com/crafter-station/latex0/issues">Issues</a>
</p>

<p align="center">
  <a href="https://nextjs.org">
    <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  </a>
  <a href="https://supabase.com">
    <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  </a>
  <a href="https://www.typescriptlang.org">
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  </a>
  <a href="https://monaco-editor.github.io">
    <img src="https://img.shields.io/badge/Monaco-68217A?style=for-the-badge&logo=visual-studio-code&logoColor=white" alt="Monaco Editor" />
  </a>
</p>

<p align="center">
  <sub>
    Built by
    <a href="https://www.crafterstation.com">
      Crafter Station
    </a>
  </sub>
</p>

## About

LATEX0 is an AI-powered LaTeX editor for the modern era. Write, compile, and collaborate in real-time.

**Researchers deserve open source tools.**

## Features

- **AI Assistant** — Chat with AI to generate and edit LaTeX code
- **Real-time Collaboration** — See other users' cursors live with unique colors
- **Document Persistence** — Save and manage multiple documents with auto-save
- **Monaco Editor** — VS Code-quality editing with LaTeX syntax highlighting
- **Live Preview** — Instant PDF rendering as you type
- **Hybrid Authentication** — Sign in with Google/GitHub via Clerk, or work as a guest

## Quick Start

```bash
# Clone
git clone https://github.com/crafter-station/latex0.git
cd latex0

# Install
bun install

# Configure
cp .env.example .env.local
# Add your environment variables (see below)

# Set up database
bun db:push

# Run
bun dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

### Required

```bash
# Supabase (for real-time collaboration)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your_supabase_key

# Database (for document persistence)
DATABASE_URL=your_postgresql_connection_string

# AI Gateway (for chat functionality)
AI_GATEWAY_API_KEY=your_ai_gateway_key

# Latex Renderer
NEXT_PUBLIC_LATEX_API_KEY=
NEXT_PUBLIC_LATEX_API_URL=
```

### Optional

```bash
# Authentication (Clerk - enables Google/GitHub OAuth)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_key
CLERK_SECRET_KEY=your_clerk_secret

# Rate Limiting (Upstash Redis)
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
```

**Note:** Guest users can use the editor without authentication. Only authenticated users (via Clerk) can save and persist documents.

## Database Setup

The project uses Drizzle ORM with PostgreSQL (via Supabase).

### Initial Setup

```bash
# Generate migration files
bun db:generate

# Push schema to database
bun db:push

# Open Drizzle Studio (database GUI)
bun db:studio
```

### Schema

The `documents` table stores saved LaTeX documents:
- `id` — Unique document ID (nanoid)
- `title` — Document title
- `content` — LaTeX source code
- `folder` — Organization folder (default: "root")
- `user_id` — Owner's Clerk user ID
- `created_at`, `updated_at` — Timestamps

### Migrations

Migration files are stored in `drizzle/` and version-controlled. The schema is defined in [lib/db/schema.ts](lib/db/schema.ts).

## Architecture

- **Repository Pattern** — Data access abstraction in `lib/db/repositories/`
- **API Routes** — Next.js API routes handle CRUD operations with Clerk authentication
- **No RLS** — Authorization is handled in API routes (not Supabase RLS) since Drizzle uses direct database connection
- **Auto-save** — Documents auto-save every 2 seconds while editing
- **URL Routing** — Each document has a unique URL (`/playground/{id}`)

## License

MIT

---

<p align="center">
  Built with care by <a href="https://www.crafterstation.com">Crafter Station</a>
</p>
