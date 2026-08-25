# Toughcuts / Barbershop System Deployment Checklist

## Migration order

Apply the migrations in filename order:

1. `202608230001_toughcuts_core_upgrade.sql`
2. `202608230002_transactional_workflows.sql`
3. `202608250001_security_hardening.sql`

Run them first in a staging project, inspect the schema diff, and test with an ordinary customer account and a separate admin account. Do not run `pasted_content.txt` as a replacement for these migrations; it is only a partial schema snapshot and does not include the RLS, policies, functions, triggers, or grants required by the application.

## Required Edge Function secrets

Configure these secrets in the deployed Supabase project:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYMONGO_SECRET_KEY`
- `PAYMONGO_WEBHOOK_SECRET`
- `SITE_URL` — the exact public site origin, without a trailing slash
- `CRON_SECRET` — a long random secret used only by the expiration scheduler

The `expire-unpaid-orders` function deliberately fails with HTTP 500 when `CRON_SECRET` is missing. This prevents an accidentally public service-role operation.

## Functions

Deploy these functions after the migration:

- `create-payment-checkout`
- `resume-payment-checkout`
- `paymongo-webhook`
- `expire-unpaid-orders`

Configure PayMongo to send signed events to `paymongo-webhook`. Configure the scheduler to make a POST request to `expire-unpaid-orders` with the header `x-cron-secret: <CRON_SECRET>`.

## Minimum smoke tests

Verify that an unauthenticated request to `expire-unpaid-orders` returns 401 or 500 and changes no rows. Verify that a customer cannot select, insert, update, or delete rows in `payment_attempts` or `stock_movements`. Verify that a customer can cancel only their own pending/awaiting-payment order through the UI. Verify that a cancelled order cannot be silently converted into a normal paid order by a late payment event; it must remain flagged for refund/manual review.
