# Repository Guidelines

## Project Structure

- `client/src/main.tsx` contains the React entry point, capture controls, and viewer UI. Keep shared styles in `client/src/style.css`.
- `client/src/session.ts` manages LiveKit connections, WebRTC tracks, and participant updates. `client/index.html` is the Vite entry page, and `client/vite.config.ts` configures the development API proxy.
- `server/src/rooms.ts` issues room-scoped tokens and validates permission to close rooms. `server/src/index.ts` serves the production frontend locally, and `api/room.ts` exposes the same room handler on Vercel. Build output goes to `client/dist/` and `server/dist/`.
- `README.md` documents Vercel deployment, Windows setup, browser testing, and Cloudflare Tunnel. `.env.example` lists the server configuration.

## Build and Development

Use Node.js 22.22 or newer. Run commands from the repository root.

- `npm install` installs dependencies.
- `npm run dev` starts Vite at `http://127.0.0.1:5173` and Express on port 3000 by default.
- `npm run build` type-checks both projects, compiles the server, and bundles the client.
- `npm start` serves the compiled app through Express after a successful build.

## Coding Style

Use strict TypeScript, two-space indentation, single quotes, and omit statement-ending semicolons. Use PascalCase for React components and camelCase for functions and variables. Keep UI styles in plain CSS. Both TypeScript configurations run during the build.

## Testing

There is no checked-in automated test suite or coverage target. Run `npm run build`, then test with a host and two viewers in separate tabs. Confirm the preview, shared invite link, moving video, participant list, and fullscreen. Verify that both the app's stop button and the browser's capture control end the session and invalidate the link. For session changes, verify room isolation and role checks.

## Security and Configuration

Keep the broadcaster secret out of viewer links and logs. Treat API requests as untrusted and grant LiveKit permissions based on server-validated roles. Keep local credentials in the ignored `.env` file and production credentials in Vercel's environment variables. Use localhost or HTTPS for screen capture.

## Commits and Pull Requests

This checkout has no Git history to establish a convention. Use short, imperative commit summaries. Describe the change and verification in pull requests, link relevant issues, and include screenshots for visible UI changes.
