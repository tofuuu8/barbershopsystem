# Toughcuts Upgrade Deployment Guide

This release adds transactional ordering, server-side appointment availability, admin scheduling controls, durable notifications, payment recovery, and richer customer profiles.

## 1. Apply the database migrations

Run the migrations in filename order against the same Supabase project used by the frontend:

```bash
supabase db push
```

If migrations are applied manually in the SQL Editor, run these files in order:

```text
supabase/migrations/202608230001_toughcuts_core_upgrade.sql
supabase/migrations/202608230002_transactional_workflows.sql
```

The staging seed is available at `supabase/seeds/seed.sql`. Do not run it against production unless replacing or merging the catalog is intentional.

## 2. Deploy Edge Functions

Deploy the checkout, recovery, webhook, and expiry functions:

```bash
supabase functions deploy create-payment-checkout
supabase functions deploy resume-payment-checkout
supabase functions deploy paymongo-webhook --no-verify-jwt
supabase functions deploy expire-unpaid-orders --no-verify-jwt
```

The webhook authenticates requests with the `PAYMONGO_WEBHOOK_SECRET`. The expiry endpoint authenticates scheduled calls with `x-cron-secret` and the `CRON_SECRET` secret.

## 3. Configure secrets

Set secrets in the Supabase project, never in frontend JavaScript:

```bash
supabase secrets set PAYMONGO_SECRET_KEY=...
supabase secrets set PAYMONGO_WEBHOOK_SECRET=...
supabase secrets set CRON_SECRET=...
supabase secrets set SITE_URL=https://your-domain.example
```

The checkout functions also need the standard Supabase function environment variables supplied by the platform, including `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Configure PayMongo

Set the PayMongo webhook endpoint to:

```text
https://<project-ref>.supabase.co/functions/v1/paymongo-webhook
```

Subscribe to the checkout/payment events used by the function, particularly successful checkout payment and failed payment events. The webhook is idempotent: already-paid orders are not paid twice, and completed payment attempts are not reverted by repeated deliveries.

## 5. Schedule unpaid-order expiry

Call the expiry function every five to ten minutes from a trusted scheduler. For example:

```bash
curl -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  "https://<project-ref>.supabase.co/functions/v1/expire-unpaid-orders"
```

The `expire_unpaid_orders()` database function cancels stale awaiting-payment orders and restores reserved stock through the inventory trigger. Configure the scheduler outside the browser; do not run this from a customer page.

## 6. Enable realtime notifications

The customer and admin pages subscribe to the `notifications` table. If realtime is disabled for that table in the project dashboard, the unread query still works, but live toast updates will not arrive until the table is added to the realtime publication.

## 7. Verify production settings

Before launch, confirm that Row Level Security is enabled, the admin profile has `is_admin = true`, the PayMongo success and cancel URLs point to the deployed `/checkout/checkout.html` and `/myorders/myorders.html` paths, and the Supabase Auth allowed redirect URLs contain the actual frontend origin.

The profile form stores saved addresses and notification preferences. In-app notifications are fully implemented. Email and SMS delivery require a separately configured provider or notification worker; the database notification records are designed to be the durable source queue for that integration.
