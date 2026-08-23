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

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const paymongoSecretKey = Deno.env.get('PAYMONGO_SECRET_KEY');
    const siteUrl = Deno.env.get('SITE_URL')?.replace(/\/$/, '');
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !paymongoSecretKey || !siteUrl) {
        return jsonResponse({ error: 'Online payment isn\u2019t configured on the server yet.' }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: 'Please log in to continue.' }, 401);
    const user = userData.user;

    let body: { orderId?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid request body.' }, 400);
    }
    if (!body.orderId || !/^[0-9a-f-]{20,}$/i.test(body.orderId)) {
        return jsonResponse({ error: 'Missing or invalid order ID.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: order, error: orderError } = await admin
        .from('orders')
        .select('id, user_id, status, payment_status, total_price, customer_name, contact_phone, expires_at')
        .eq('id', body.orderId)
        .eq('user_id', user.id)
        .single();

    if (orderError || !order) return jsonResponse({ error: 'Order not found.' }, 404);
    if (order.status !== 'awaiting_payment' || order.payment_status === 'paid') {
        return jsonResponse({ error: 'This order isn\u2019t waiting on payment anymore.' }, 409);
    }
    if (order.expires_at && new Date(order.expires_at).getTime() <= Date.now()) {
        await admin.from('orders').update({ status: 'cancelled', payment_status: 'failed', cancel_reason: 'Payment window expired', cancelled_at: new Date().toISOString() }).eq('id', order.id);
        return jsonResponse({ error: 'This payment window expired. Please place the order again.' }, 409);
    }

    const { data: items, error: itemsError } = await admin
        .from('order_items')
        .select('product_name, unit_price, quantity')
        .eq('order_id', order.id);
    if (itemsError || !items?.length) return jsonResponse({ error: 'Could not load this order\u2019s items.' }, 500);

    const expiresAt = order.expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const paymongoRes = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic ' + btoa(paymongoSecretKey + ':')
        },
        body: JSON.stringify({
            data: {
                attributes: {
                    billing: { name: order.customer_name || undefined, email: user.email, phone: order.contact_phone || undefined },
                    line_items: items.map((item) => ({
                        name: item.product_name,
                        amount: Math.round(Number(item.unit_price) * 100),
                        currency: 'PHP',
                        quantity: item.quantity
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

    const paymongoData = await paymongoRes.json().catch(() => null);
    if (!paymongoRes.ok || !paymongoData?.data?.id || !paymongoData.data.attributes?.checkout_url) {
        console.error('PayMongo recovery error:', paymongoData);
        return jsonResponse({ error: 'Could not start payment. Please try again.' }, 502);
    }

    const session = paymongoData.data;
    const { error: updateError } = await admin.from('orders').update({
        payment_reference: session.id,
        payment_status: 'pending',
        last_payment_attempt_at: new Date().toISOString(),
        expires_at: expiresAt
    }).eq('id', order.id).eq('status', 'awaiting_payment');
    const { error: attemptError } = await admin.from('payment_attempts').insert({
        order_id: order.id,
        provider: 'paymongo',
        checkout_session_id: session.id,
        status: 'created',
        amount: order.total_price,
        expires_at: expiresAt
    });

    if (updateError || attemptError) {
        console.error('Could not record payment recovery attempt:', updateError || attemptError);
        return jsonResponse({ error: 'Payment started, but we could not record the attempt. Please contact the studio if needed.' }, 500);
    }

    return jsonResponse({ orderId: order.id, checkoutUrl: session.attributes.checkout_url, expiresAt });
});
