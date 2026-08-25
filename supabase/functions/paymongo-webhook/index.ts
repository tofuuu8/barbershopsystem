import { createClient } from 'jsr:@supabase/supabase-js@2';

function parseSignatureHeader(header: string | null) {
    const values: Record<string, string> = {};
    for (const part of header?.split(',') ?? []) {
        const index = part.indexOf('=');
        if (index > 0) values[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
    return values;
}

async function verifyPaymongoSignature(rawBody: string, signatureHeader: string | null, secret: string) {
    const parts = parseSignatureHeader(signatureHeader);
    if (!parts.t || (!parts.te && !parts.li)) return false;
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${rawBody}`));
    const expected = Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return expected === parts.te || expected === parts.li;
}

function jsonAck(body: Record<string, unknown> = { received: true }) {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const rawBody = await req.text();
    const secret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET');
    if (!secret) {
        console.error('PAYMONGO_WEBHOOK_SECRET is not set.');
        return jsonAck({ received: true, processed: false });
    }
    if (!(await verifyPaymongoSignature(rawBody, req.headers.get('Paymongo-Signature'), secret))) {
        console.warn('PayMongo webhook signature did not match.');
        return jsonAck({ received: true, processed: false });
    }

    let event: any;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return jsonAck({ received: true, processed: false });
    }

    const eventType = String(event?.data?.attributes?.type ?? '');
    const resource = event?.data?.attributes?.data;
    const attributes = resource?.attributes ?? {};
    const checkoutSessionId = resource?.id;
    const referenceNumber = attributes.reference_number || attributes.metadata?.order_id;
    const paymentId = attributes.payments?.[0]?.id || resource?.id;
    const providerEventId = event?.data?.id || event?.id || `${eventType}:${checkoutSessionId || ''}:${paymentId || ''}`;
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return jsonAck({ received: true, processed: false });

    const admin = createClient(supabaseUrl, serviceRoleKey);
    if (providerEventId) {
        const { data: alreadyProcessed } = await admin.from('payment_attempts')
            .select('id')
            .eq('provider_event_id', providerEventId)
            .maybeSingle();
        if (alreadyProcessed) return jsonAck({ received: true, processed: true, duplicate: true });
    }
    let order: any = null;
    if (referenceNumber) {
        const { data } = await admin.from('orders').select('id, user_id, status, payment_status, cancel_reason').eq('id', referenceNumber).maybeSingle();
        order = data;
    }
    if (!order && checkoutSessionId) {
        const { data } = await admin.from('orders').select('id, user_id, status, payment_status, cancel_reason').eq('payment_reference', checkoutSessionId).maybeSingle();
        order = data;
    }
    if (!order) {
        console.warn('PayMongo event did not match an order.', { eventType, referenceNumber, checkoutSessionId });
        return jsonAck({ received: true, processed: false });
    }

    const isPaid = eventType === 'checkout_session.payment.paid' || eventType === 'payment.paid';
    const isFailed = eventType === 'payment.failed';
    if (!isPaid && !isFailed) {
        return jsonAck({ received: true, processed: false, paymentId });
    }
    const completedAt = new Date().toISOString();

    let attemptUpdate = admin.from('payment_attempts')
        .update({
            status: isPaid ? 'paid' : 'failed',
            completed_at: completedAt,
            provider_event_id: providerEventId,
            raw_payload: event
        })
        .eq('order_id', order.id)
        .eq('status', 'created');
    if (checkoutSessionId) attemptUpdate = attemptUpdate.eq('checkout_session_id', checkoutSessionId);
    const { error: attemptError } = await attemptUpdate;
    if (attemptError) console.error('Could not update payment attempt:', attemptError);

    if (isPaid && order.payment_status !== 'paid') {
        const wasCancelled = order.status === 'cancelled';
        const { error } = await admin.from('orders').update({
            payment_status: wasCancelled ? 'failed' : 'paid',
            status: wasCancelled ? 'cancelled' : (order.status === 'awaiting_payment' ? 'pending' : order.status),
            paid_at: wasCancelled ? null : completedAt,
            payment_reference: checkoutSessionId || undefined,
            cancel_reason: wasCancelled
                ? `${order.cancel_reason || 'Order was cancelled'}; Payment completed after cancellation — manual refund required.`
                : order.cancel_reason
        }).eq('id', order.id).neq('payment_status', 'paid');
        if (error) console.error('Could not update order payment state:', error);

        if (wasCancelled) {
            await admin.from('notifications').insert({
                audience: 'admin',
                event_type: 'payment_after_cancellation',
                title: 'Manual refund required',
                body: `Payment completed after order ${order.id} was cancelled. Review and refund manually.`,
                entity_type: 'order',
                entity_id: order.id
            });
        }
    } else if (isFailed && order.payment_status !== 'paid' && order.status === 'awaiting_payment') {
        const { error } = await admin.from('orders').update({
            status: 'cancelled',
            payment_status: 'failed',
            cancel_reason: 'Payment failed',
            cancelled_at: completedAt
        }).eq('id', order.id).eq('status', 'awaiting_payment');
        if (error) console.error('Could not cancel failed payment order:', error);
    }

    return jsonAck({ received: true, processed: isPaid || isFailed, paymentId });
});
