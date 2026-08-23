// ============================================================
// supabase/functions/paymongo-webhook/index.ts
// ============================================================
// Public endpoint — PayMongo calls this server-to-server when a
// Checkout Session's payment succeeds or fails. This is the source of
// truth for "did the customer actually pay," not the success/cancel
// redirect (which just sends the customer's browser back to your
// site and proves nothing — they could close the tab, or the redirect
// could be spoofed).
//
// Deploy WITHOUT JWT verification — PayMongo can't send a Supabase
// user session, and this endpoint verifies PayMongo's own signature
// instead:
//   supabase functions deploy paymongo-webhook --no-verify-jwt
//
// Then register it in the PayMongo Dashboard (Developers -> Webhooks
// -> Add endpoint), pointed at this function's URL, listening for at
// least: checkout_session.payment.paid
// PayMongo will show you the endpoint's signing secret once — save it.
//
// Required secrets:
//   PAYMONGO_WEBHOOK_SECRET   the whsk_... shown when you register the
//                             endpoint above
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// PayMongo's signature scheme (per their docs): the Paymongo-Signature
// header is "t=<timestamp>,te=<test-mode signature>,li=<live-mode
// signature>". You compute HMAC-SHA256 of "<t>.<raw body>" using the
// webhook's secret key, then check whether it matches EITHER te or li
// — whichever matches tells you which mode the event is (and confirms
// it really came from PayMongo). This must run against the raw
// request body text, not a re-serialized/parsed version, or the
// signature will never match.
async function verifyPaymongoSignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
    if (!signatureHeader) return false;

    const parts = Object.fromEntries(
        signatureHeader.split(',').map((pair) => {
            const [key, value] = pair.split('=');
            return [key, value];
        })
    );
    const timestamp = parts.t;
    const testSig = parts.te;
    const liveSig = parts.li;
    if (!timestamp || (!testSig && !liveSig)) return false;

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
    const computedHex = Array.from(new Uint8Array(signatureBytes))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    return computedHex === testSig || computedHex === liveSig;
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    // Must read the raw text BEFORE any JSON parsing — signature
    // verification needs the exact bytes PayMongo signed.
    const rawBody = await req.text();
    const secret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET');

    if (!secret) {
        console.error('PAYMONGO_WEBHOOK_SECRET is not set.');
        return new Response('OK', { status: 200 }); // ack anyway; nothing we can safely process without the secret
    }

    const isValid = await verifyPaymongoSignature(rawBody, req.headers.get('Paymongo-Signature'), secret);
    if (!isValid) {
        console.warn('PayMongo webhook signature did not match — ignoring event.');
        // Return 200 rather than 4xx: an invalid signature could just
        // as easily be a misconfiguration on PayMongo's dashboard side
        // as an actual attack, and returning an error status here risks
        // PayMongo auto-disabling the endpoint after repeated failures.
        // Nothing below this point processes an unverified event either way.
        return new Response('OK', { status: 200 });
    }

    let event: any;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return new Response('OK', { status: 200 });
    }

    const eventType: string = event?.data?.attributes?.type ?? '';
    const eventResource = event?.data?.attributes?.data;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // reference_number was set to our own order id at creation time
    // (see create-payment-checkout), so that's the primary lookup —
    // it doesn't depend on exactly how each event nests the checkout
    // session id. payment_reference (the checkout session id itself)
    // is the fallback.
    const referenceNumber: string | undefined = eventResource?.attributes?.reference_number;
    const checkoutSessionId: string | undefined = eventResource?.id;

    async function findOrder() {
        if (referenceNumber) {
            const { data } = await admin.from('orders').select('id, status, payment_status').eq('id', referenceNumber).maybeSingle();
            if (data) return data;
        }
        if (checkoutSessionId) {
            const { data } = await admin.from('orders').select('id, status, payment_status').eq('payment_reference', checkoutSessionId).maybeSingle();
            if (data) return data;
        }
        return null;
    }

    if (eventType === 'checkout_session.payment.paid') {
        const order = await findOrder();
        if (!order) {
            console.error('paymongo-webhook: no matching order for paid event', { referenceNumber, checkoutSessionId });
            return new Response('OK', { status: 200 });
        }
        // Idempotency guard — PayMongo can and will retry webhook
        // delivery; only act the first time this order is marked paid.
        if (order.payment_status !== 'paid') {
            await admin
                .from('orders')
                .update({ payment_status: 'paid', status: 'pending', paid_at: new Date().toISOString() })
                .eq('id', order.id);
        }
    } else if (eventType === 'payment.failed') {
        const order = await findOrder();
        if (order && order.payment_status === 'unpaid' && order.status === 'awaiting_payment') {
            // Cancelling here (rather than a bespoke "failed" status)
            // reuses trg_adjust_stock_on_order_status_change to return
            // the reserved stock — same path a manual admin cancel takes.
            await admin.from('orders').update({ status: 'cancelled', payment_status: 'failed' }).eq('id', order.id);
        }
    }
    // Other event types (payment.paid without a checkout session,
    // refunds, disputes, etc.) aren't handled yet — add cases above as
    // you register for more events in the PayMongo dashboard.

    return new Response('OK', { status: 200 });
});