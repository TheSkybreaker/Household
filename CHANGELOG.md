# Changelog

## Conti milestone 1: shared infrastructure

- pnpm monorepo with the Spesa in `apps/shopping`, Conti in `apps/cash` (login and profile) and `packages/shared` (session client, amounts, dates, app list, shared components and styles); the backend is the Go module `household` and no longer serves files.
- One login for both apps in an HttpOnly cookie on `.skybreaker.dev`, accepted only on same-origin requests; push subscriptions per app; Caddy serves the two builds, hides the dashboard, and the workflow deploys only what changed.

## Production

- Sign in with a username instead of an email (lowercased on the login page), trusted `X-Forwarded-For` from Caddy and PocketBase rate limits on, and `VAPID_SUBJECT` accepted with or without `mailto:`.
- GitHub Actions workflow that tests, builds and deploys every push to `main` to shopping.skybreaker.dev; the `deploy/` folder is gone and the server configuration lives on the server, described in `docs/DESIGN.md`.
- Shorter interface copy ("Scopri subito cosa manca", no partner name in the empty home and under the notifications switch) and no realtime indicator in the top bar.
- Items can be edited: the pencil next to the delete button or a long press on the row, which fills while held, opens a sheet with name and quantity, saved optimistically with the same duplicate check as adding.

## Milestone 5: deploy

- `go build -tags embed` compiles the frontend into the binary; without the tag, development keeps reading `pb_public` from disk.
- `deploy/`: Caddyfile with the domain from `SPESA_DOMAIN`, the hardened `spesa.service`, and `backup.sh` with its daily timer copying the newest PocketBase backup to `BACKUP_DESTINATION`.

## Milestone 4: push notifications

- Web Push from the items hook to the other person's devices (TTL 12 h, high urgency, list id as topic), subscriptions dropped on 404 and 410, and the `/api/push` routes, tested with a fake push service.
- Service worker notifications grouped per list and skipped with the app on screen, opening the list on tap; home card, profile switch, unsubscribe on logout and "Prova notifica" in development.

## Milestone 3: PWA

- Web app manifest, generated icons (`pnpm icons`), a Workbox service worker that precaches the app shell and never the API, and the new version toast with Aggiorna.
- Offline read only mode from the last state saved per view, with the offline banner and disabled actions; "Installa l'app" in the profile while Chrome offers it.

## Milestone 2: frontend base

- Static Astro frontend built into `backend/pb_public`, with Alpine stores, self-hosted fonts, the dark theme only, login with page guards, home, new list, list detail with add, check, delete and undo, and Vitest tests for the parser, dates and grouping.
- Realtime sync through the stores, reloaded when the app returns or the connection comes back; `items.added_at` puts an item taken back from the cart at the end of the items to buy.

## Milestone 1: backend

- PocketBase v0.40.4 used as a Go framework, with one migration for the `users` extra fields, `lists`, `items` and `push_subscriptions`, their API rules and indexes.
- `vapid` command, environment loaded from an optional `.env`, static serving that keeps the query on the `/lista` redirect, and API rule tests.
