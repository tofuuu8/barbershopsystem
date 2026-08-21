# Base44 Dev Environment

## What this is
Toughcuts — a static HTML/CSS/JS barbershop site (no build step, no framework).
The `frontend/` directory is served directly by nginx.

## Architecture
- **Frontend:** plain static files in `frontend/` (index.html at root, subpages
  in subdirectories: booking/, products/, services/, login/, account/, etc.).
  Shared JS in `frontend/js/` (`main.js`, `supabase.js`), shared CSS in
  `frontend/css/style.css`.
- **Backend:** hosted Supabase. The project URL and **public anon key** are
  hardcoded in `frontend/js/supabase.js` — the anon key is safe to expose
  client-side (RLS is expected on tables). No local Supabase is needed to run
  the preview; the frontend talks to the remote project directly.
- `supabase/config.toml` is the Supabase CLI local-dev config; there is no
  `migrations/` directory yet.

## Running
```
docker compose -f docker-compose.base44.yml up -d
```
nginx serves `frontend/` on host port 3000. Edits to files under `frontend/`
are reflected immediately (nginx reads from the bind mount on every request —
no reload needed).

## Verification
- `curl -sf http://localhost:3000/` returns the homepage (HTTP 200).
- Subpages: `/booking/booking.html`, `/products/products.html`, etc.
- No external credentials are required — the Supabase anon key is committed
  in the client code.
