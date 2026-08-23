# Toughcuts System Upgrade

## Implemented improvements

This upgrade includes versioned Supabase migrations, reproducible seed data, transactional order creation, inventory reservation and restocking, server-side appointment availability, staff schedule and blocked-time management, admin order and appointment workflows, durable customer/admin notifications, payment recovery, unpaid-order expiry, and richer customer profile preferences.

## Main user-facing changes

Customers can now save a default address, multiple delivery addresses, a preferred barber, a default pickup or delivery choice, and notification preferences. Checkout uses those preferences when available. Appointment slots are generated from server-side barber schedules and blocked times, while final appointment creation performs an atomic conflict check and assigns a barber safely.

Customers can resume an incomplete online payment while the payment window is open. Expired payment windows are shown clearly in My Orders. Durable notifications appear as account badges and in-app toasts for order and appointment changes.

## Main staff-facing changes

Administrators can move orders through pending, preparing, ready, out-for-delivery, completed, and cancelled states. They can confirm, reschedule, reassign, complete, cancel, or mark appointments as no-show. The new Availability page manages recurring barber hours and blocked leave or maintenance windows. Notifications for accounts, bookings, orders, payments, and low-stock products are stored in the database and can be marked read.

## Database and server changes

The new SQL migrations add core profile, barber, service, delivery-area, scheduling, event, notification, and payment-attempt structures; RLS policies; transactional order and booking functions; inventory triggers; order and booking event triggers; payment expiry; and admin-only workflow functions. Online payment functions now use authoritative order totals and durable payment attempts. The PayMongo webhook validates signatures and is idempotent for paid or failed events.

## Verification

The following checks passed locally:

- Frontend and admin JavaScript syntax checks.
- Local HTML asset-reference verification.
- Known authentication return-target verification.
- PostgreSQL parsing of both migration files.
- Bundling and syntax checks for all Supabase Edge Functions.
- Browser smoke tests for the account, booking, checkout, and protected admin Availability routes.

Live authentication, database execution, PayMongo transactions, and scheduled production invocation were not run in this sandbox because they require the project’s deployed Supabase credentials and payment configuration.

## Deployment

Follow `UPGRADE_DEPLOYMENT.md` for migration order, Edge Function deployment, secrets, PayMongo webhook configuration, expiry scheduling, realtime setup, and production verification.
