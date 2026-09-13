# CanvasVault

A personal, Google Drive-backed application embedding the official [Excalidraw](https://excalidraw.com) editor with native `.excalidraw` file persistence.

## Core Features

- **Embedded Excalidraw**: Uses the official `@excalidraw/excalidraw` editor without modifying canvas internals.
- **Native File Compatibility**: Saves and loads native `.excalidraw` JSON files preserving elements, app state, and embedded binary files. Files are directly compatible with standard Excalidraw.
- **Storage Abstraction**: Clean `DrawingStorage` interface isolating persistence logic from the application UI.
- **Debounced Auto-Save**: Inactivity-debounced persistence with explicit save indicators (`Saved`, `Saving...`, `Unsaved changes`, `Save failed`).
- **File Management**: Create, open, rename, and delete drawings via the application sidebar.

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
```

### Configuration

Copy the example environment file:

```bash
cp .env.example .env.local
```

Configure your Google OAuth Web Client ID in `.env.local`:

```bash
VITE_GOOGLE_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
```

### Development

```bash
npm run dev
```

The application will start at `http://localhost:5173`.

### Verification & Linting

```bash
# Type check and build bundle
npm run build

# Run linter
npm run lint
```
