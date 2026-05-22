# Beatrice Eburon AI - Project Context

This file provides instructional context for the Beatrice Eburon AI project, a sophisticated AI assistant integrating Gemini's Multimodal Live API with various third-party services and system-level capabilities.

## Project Overview
Beatrice Eburon AI (internally `native-audio-function-call-sandbox`) is a high-performance, visually polished AI companion. It features real-time voice, video, and screen-sharing interactions, combined with extensive tool-calling capabilities.

### Key Technologies
- **Frontend:** React 19, Vite, Tailwind CSS 4, Zustand (state management), Framer Motion (animations), Lucide React (icons).
- **Backend:** Node.js, Express, `tsx` (runtime), `esbuild` (bundler).
- **AI Models:** 
    - Gemini Multimodal Live API (`gemini-2.0-flash-exp` or similar) for real-time interaction.
    - `gemini-3.1-flash-lite` for text-based chat.
    - Ollama (self-hosted) for embeddings (`nomic-embed-text`) and RAG (`gemma`).
- **Database & Storage:**
    - **Firebase:** Authentication and Firestore (user settings, notes, real-time sync).
    - **PostgreSQL:** Long-term conversation history.
    - **ChromaDB:** Vector store for semantic memory and RAG.
- **Integrations:**
    - **WhatsApp:** Multi-device integration via GoWA.
    - **Google Workspace:** Keep, Tasks, Calendar, Drive, Gmail, Sheets, Slides, Contacts.
    - **System Sandbox:** Command-line execution capabilities.

## Architecture
- `server.ts`: Unified backend serving API routes and the Vite frontend. Handles authentication (Firebase Admin), database connections, and proxying to external services (WhatsApp, Search, Ollama).
- `EburonApp.tsx`: Main React application component. Manages the "Blue Orb" voice interface, "Sight" (video) overlay, and various tool integrations.
- `lib/genai-live-client.ts`: Core wrapper for the Gemini Multimodal Live SDK, handling WebSocket communication, audio streaming, and tool call dispatching.
- `lib/tools/`: Directory containing function declarations for AI tools (e.g., `sandbox.ts`, `whatsapp.ts`, `navigation-system.ts`).
- `contexts/LiveAPIContext.tsx`: React Context provider for the Live API client.

## Development Workflows

### Prerequisites
- Node.js (Latest LTS recommended).
- PostgreSQL and ChromaDB (for memory features).
- Ollama (optional, for self-hosted RAG).
- Firebase project for Auth and Firestore.

### Key Commands
- `npm install`: Install dependencies.
- `npm run dev`: Start the development server (Vite + Express).
- `npm run build`: Build the frontend and bundle the backend for production.
- `npm start`: Run the bundled production server.
- `npm run lint`: Run ESLint.

### Environment Variables
Key variables required in `.env`:
- `GEMINI_API_KEY`: Google AI Studio API key.
- `FIREBASE_PROJECT_ID`: Firebase project identifier.
- `GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_ENGINE_ID`: For web search capabilities.
- `GOWA_URL` / `GOWA_AUTH`: For WhatsApp integration.
- `OLLAMA_URL`: URL for self-hosted Ollama instance.

## Branding & UI Conventions
- **Primary Color:** `#CAF645` (Lime Green).
- **Glow Blue:** `#1590F5` (Accent for active states).
- **Background:** Pure Black (`#000000`) and Dark Grey Surface (`#111111`).
- **Persona:** "Beatrice" - warm, professional, vibrant, and human-like.
- **Language Support:** Native Flemish/Dutch support with colloquialisms (`Amai!`, `Keigoe!`).

## Development Guidelines
- **Type Safety:** Use TypeScript for all new features. Ensure interfaces are defined for API responses and tool parameters.
- **Surgical Edits:** When modifying `EburonApp.tsx`, be mindful of its size (~3.7k lines). Use targeted edits.
- **Tool Definitions:** Add new tool declarations in `lib/tools/` and register them in `EburonApp.tsx` or `server.ts` as appropriate.
- **Security:** Never log or commit secrets. Use the `authenticateToken` middleware for all new API routes.
- **Testing:** Add or update tests when modifying core logic, especially in `lib/genai-live-client.ts`.

---
*Note: This file is a foundational mandate for Gemini CLI interactions within this project.*
