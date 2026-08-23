// ============================================================
// supabase/functions/resume-payment-checkout/index.ts
// ============================================================
// Called when a customer wants to pay for an order they already
// created but abandoned (status: 'awaiting_payment'). Unlike
// create-payment-checkout, this does NOT insert a new order or
// order_items — those already exist and already reserved stock.
// It only re-reads the existing order, builds a fresh PayMongo
// Checkout Session for the same amount, and updates payment_reference.
//
// Deploy:
//   supabase functions deploy resume-payment-checkout
//
// Reuses the same secrets as create-payment-checkout:
//   PAYMONGO_SECRET_KEY, SITE_URL
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const paymongoSecretKey = Deno.env.get('PAYMONGO_SECRET_KEY');
    const siteUrl = Deno.env.get('SITE_URL');

    if (!paymongoSecretKey || !siteUrl) {
        return jsonResponse({ error: 'Online payment isn\u2019t configured on the server yet.' }, 500);
    }

    const authClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
        return jsonResponse({ error: 'Please log in to continue.' }, 401);
    }
    const user = userData.user;

    let body: { orderId?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid request body.' }, 400);
    }
    if (!body.orderId) {
        return jsonResponse({ error: 'Missing order ID.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Only ever resume the caller's OWN order, and only if it's still
    // actually awaiting payment — never let this be used to re-trigger
    // payment on someone else's order or one that's already paid/cancelled.
    const { data: order, error: orderError } = await admin
        .from('orders')
        .select('id, user_id, status, payment_status, total_price, contact_phone')
        .eq('id', body.orderId)
        .eq('user_id', user.id)
        .single();

    if (orderError || !order) {
        return jsonResponse({ error: 'Order not found.' }, 404);
    }
    if (order.status !== 'awaiting_payment' || order.payment_status === 'paid') {
        return jsonResponse({ error: 'This order isn\u2019t waiting on payment anymore.' }, 409);
    }

    const { data: items, error: itemsError } = await admin
        .from('order_items')
        .select('product_name, unit_price, quantity')
        .eq('order_id', order.id);

    if (itemsError || !items?.length) {
        return jsonResponse({ error: 'Could not load this order\u2019s items.' }, 500);
    }

    const paymongoRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic ' + btoa(paymongoSecretKey + ':')
        },
        body: JSON.stringify({
            data: {
                attributes: {
                    billing: { email: user.email, phone: order.contact_phone ?? undefined },
                    line_items: items.map((i) => ({
                        name: i.product_name,
                        amount: Math.round(Number(i.unit_price) * 100),
                        currency: 'PHP',
                        quantity: i.quantity
                    })),
                    payment_method_types: ['gcash', 'paymaya', 'grab_pay', 'card'],
                    description: `Toughcuts order ${order.id}`,
                    reference_number: order.id,
                    send_email_receipt: true,
                    success_url: `${siteUrl}/checkout/checkout.html?order=${order.id}&payment=success`,
                    cancel_url: `${siteUrl}/myorders/myorders.html?order=${order.id}&payment=cancelled`
                }
            }
        })
    });

    const paymongoData = await paymongoRes.json();
    if (!paymongoRes.ok) {
        console.error('PayMongo error:', paymongoData);
        return jsonResponse({ error: 'Could not start payment. Please try again.' }, 502);
    }

    const session = paymongoData.data;
    await admin.from('orders').update({ payment_reference: session.id }).eq('id', order.id);

    return jsonResponse({ checkoutUrl: session.attributes.checkout_url });
});