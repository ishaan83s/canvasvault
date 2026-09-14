# CanvasVault

CanvasVault is a browser-based whiteboard application that embeds the official [Excalidraw](https://excalidraw.com) infinite canvas with direct-to-storage persistence. Built with React, TypeScript, and Vite, it operates entirely on the client side without any intermediate application server or custom database. CanvasVault allows users to sketch and organize diagrams locally using browser storage or connect with Google OAuth to persist drawings directly in their personal Google Drive with complete per-user isolation.

## Screenshots

> _Screenshots will be added in an upcoming update._

<!-- Placeholder for interface screenshots:
- Canvas view with infinite drawing tools
- File management sidebar with create, rename, and delete
- Google Drive sign-in and migration dialogs
-->

## Features

- **Excalidraw Infinite Canvas**: Full-featured digital whiteboard powered by the official `@excalidraw/excalidraw` library.
- **Native File Compatibility**: Saves and loads native `.excalidraw` JSON format (compatible with excalidraw.com), preserving elements, app state, and binary image attachments.
- **Google OAuth Authentication**: Secure client-side sign-in using Google Identity Services (GIS).
- **Per-User Google Drive Persistence**: Diagrams are saved directly into a dedicated `CanvasVault` folder within the user's personal Google Drive.
- **LocalStorage Fallback**: Complete offline and anonymous usage using browser `localStorage` when not signed in.
- **Multiple Drawing Management**: Create, open, rename, and delete drawings directly from the collapsible sidebar.
- **Autosave with Dirty-State Tracking**: Debounced automatic persistence with real-time status indicators (`Saved`, `Saving...`, `Unsaved changes`, `Save failed`).
- **Safe State Transitions**: Guarded modal prompts prevent accidental data loss:
  - Save and Switch / Discard and Switch
  - Save and Create / Discard and Create
- **Local-to-Google-Drive Migration**: Migrate existing local drawings into Google Drive seamlessly upon authentication.
- **Concurrency & Race-Condition Protection**: Sequence numbering, generation guards, and operation locking prevent out-of-order writes, stale overwrites, or race conditions during rapid file operations.
- **Per-User Storage Isolation**: Storage is isolated between local guest data and authenticated Google Drive accounts.
- **Browser-Only Architecture**: Zero custom backend, application server, or hosted database; communicates directly with browser APIs and the Google Drive REST API.

## Tech Stack

- **Frontend Framework**: React 19
- **Language**: TypeScript 6
- **Build Tool / Bundler**: Vite 8
- **Canvas Engine**: `@excalidraw/excalidraw`
- **Authentication**: Google Identity Services (GIS) OAuth 2.0
- **Storage**: Browser `localStorage` & Google Drive REST API v3
- **Code Quality**: Oxlint & TypeScript compiler (`tsc`)

## Architecture & Storage Explanation

CanvasVault is designed with a strictly client-side, zero-backend architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    CanvasVault (Browser)                    │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │             Excalidraw Canvas Component             │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │                              │
│   ┌──────────────────────────▼──────────────────────────┐   │
│   │           useDrawingPersistence Hook                │   │
│   └──────────┬───────────────────────────────┬──────────┘   │
│              │ (Anonymous)                   │ (Auth)       │
│   ┌──────────▼───────────┐       ┌───────────▼──────────┐   │
│   │ LocalStorage Adapter │       │  Google Drive Adapter│   │
│   └──────────┬───────────┘       └───────────┬──────────┘   │
└──────────────┼───────────────────────────────┼──────────────┘
               │                               │
        ┌──────▼──────┐                 ┌──────▼──────┐
        │ LocalStorage│                 │Google Drive │
        │  (Browser)  │                 │  (REST API) │
        └─────────────┘                 └─────────────┘
```

- **No Backend / Database**: There is no custom API server, database, or intermediary service. All serialization, state management, and persistence logic run entirely in the user's browser.
- **Anonymous / Local Mode**:
  - When not signed in, drawings are persisted to browser `localStorage`.
  - Content is serialized into valid `.excalidraw` JSON and keyed under distinct document IDs.
  - Requires no internet connection and no account setup.
- **Authenticated Google Drive Mode**:
  - When signed in, the application uses an OAuth 2.0 access token to communicate directly with the Google Drive v3 REST API.
  - Automatically identifies or creates a dedicated `CanvasVault` root folder marked with application properties.
  - Saves diagrams via multipart uploads, maintaining standard `.excalidraw` file formatting and application-level metadata tags.
  - Access tokens are stored exclusively in memory and are never persisted to disk or sent to any third party.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- `npm` (v9 or higher)

### Setup Instructions

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ishaan83s/canvasvault.git
   cd canvasvault
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Create a `.env.local` file from the provided example:
   ```bash
   cp .env.example .env.local
   ```

   Open `.env.local` and configure your Google OAuth Web Client ID:
   ```env
   VITE_GOOGLE_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

## Google OAuth Setup Requirements

To enable Google Drive persistence, set up an OAuth 2.0 Client ID in the Google Cloud Console:

1. **Create a Google Cloud Project**:
   - Go to the [Google Cloud Console](https://console.cloud.google.com/).
   - Create a new project or select an existing one.

2. **Enable the Google Drive API**:
   - Navigate to **APIs & Services > Library**.
   - Search for **Google Drive API** and click **Enable**.

3. **Configure the OAuth Consent Screen**:
   - Navigate to **APIs & Services > OAuth consent screen**.
   - Select User Type (choose **External** for standard accounts).
   - Fill in required application information (name, support email).
   - Under **Scopes**, add the non-sensitive or drive-file scope: `https://www.googleapis.com/auth/drive.file`.
   - If the publishing status is set to **Testing**, add your Google email address under **Test users**.

4. **Create OAuth 2.0 Client Credentials**:
   - Navigate to **APIs & Services > Credentials**.
   - Click **Create Credentials > OAuth client ID**.
   - Select **Web application** as the application type.
   - Under **Authorized JavaScript origins**, add your development and production URLs:
     - `http://localhost:5173`
     - Any production origin where the app is hosted.
   - Click **Create** and copy the generated **Client ID**.

5. **Update `.env.local`**:
   - Paste your Client ID into `VITE_GOOGLE_CLIENT_ID` in `.env.local`.

> **Note on Google OAuth Verification**:
> CanvasVault is currently in public beta and Google OAuth application verification has not yet been completed. If you see a *"Google hasn't verified this app"* warning during sign-in, you can proceed by clicking **Advanced > Go to CanvasVault (unsafe)**, or ensure your Google account is registered under **Test users** in your Google Cloud Console.

## Available Scripts

- `npm run dev`: Starts the local Vite development server with hot module replacement.
- `npm run build`: Type-checks with TypeScript (`tsc -b`) and bundles production assets with Vite.
- `npm run lint`: Analyzes codebase with `oxlint` for performance and code correctness.
- `npm run preview`: Starts a local web server to preview the production build output.

## Privacy & Security

- **Minimal Google Drive Scope**: CanvasVault requests the `https://www.googleapis.com/auth/drive.file` scope. It only accesses files and folders created by CanvasVault itself and cannot read, alter, or delete any other files in your Google Drive.
- **No Server Credentials**: Client secrets are not used or needed. Only the public OAuth Web Client ID is used in the browser.
- **Environment Files Ignored**: `.env` and `.env.*` files are explicitly included in `.gitignore` to prevent leaking local configuration.
- **Direct Client-to-Google Communication**: All Google Drive API requests are dispatched directly from your browser to Google endpoints. CanvasVault does not operate a backend that proxies or stores drawing data.
- **Account Control & Revocation**: OAuth access tokens exist only in browser memory and expire automatically. You can disconnect inside CanvasVault or revoke permissions at any time via your [Google Account Permissions](https://myaccount.google.com/permissions).

## Current Status

CanvasVault is currently in **Public Beta**. Core drawing functionality, local persistence, Google Drive storage synchronization, migration, and race-condition guards are fully functional and covered by an automated test suite. Google OAuth application verification has not yet been completed.

## Limitations

- **Browser-Only**: Operates entirely within the browser. Requires direct connectivity to Google APIs when in Google Drive mode; offline changes while in Google Drive mode cannot sync until reconnected.
- **Google OAuth Verification Warning**: Users may encounter an unverified app warning on the Google consent screen until verification is completed.
- **No Real-Time Collaboration**: Multi-user simultaneous live canvas collaboration is not supported. CanvasVault is designed for individual diagram creation and personal Drive storage.

## License

License has not yet been selected. All rights reserved.
