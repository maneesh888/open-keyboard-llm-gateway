# Requirement: Admin Web UI for LLM Gateway

## Context
The LLM Gateway backend (Hono + TypeScript) is fully functional with 118 passing tests. It provides an Admin API for authentication and API key management (CRUD). However, the frontend UI is currently missing, resulting in a "404 Not Found" when visiting `/ui`.

## Objective
Create a modern, responsive, single-page Admin Web UI to manage the gateway.

## Functional Requirements
1.  **Login Screen**:
    *   Fields for Username and Password.
    *   Authenticates via `POST /admin/login`.
    *   Stores JWT token securely (LocalStorage or SessionStorage).
2.  **Dashboard / Key Management**:
    *   Table displaying all API Keys (`GET /admin/keys`).
    *   Ability to Create a new key (`POST /admin/keys`).
    *   Ability to Edit existing keys (`PATCH /admin/keys/:id`).
    *   Ability to Delete/Revoke keys (`DELETE /admin/keys/:id`).
3.  **Key Configuration Fields**:
    *   Name, Owner, Requests Per Minute, Burst Allowance.
    *   Model Config (Model name, Max Tokens, Temperature).
    *   Feature Toggles (Suggestions, Custom Actions).
4.  **Security**:
    *   Protect the `/ui` route; redirect to login if no token is present.
    *   Include Bearer token in all API requests.

## Technical Stack Preferences
*   **Framework**: Single HTML file with Tailwind CSS + Vanilla JS (for simplicity) or a lightweight React/Vue setup if standard in the project.
*   **Integration**: Serve the static files from the Hono backend (e.g., using `hono/serve-static`).
*   **Route**: Must be accessible at `/ui`.

## Deliverables
*   Frontend source files (HTML/JS/CSS).
*   Updated `src/index.ts` to serve the static UI folder.
*   Updated `package.json` build scripts if necessary.
