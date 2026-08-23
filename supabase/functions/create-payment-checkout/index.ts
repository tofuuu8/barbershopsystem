import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const ALLOWED_PAYMENT_METHODS = new Set(['gcash', 'paymaya', 'grab_pay', 'card', 'qrph']);

interface CheckoutItemRequest {
    product_id: string;
    quantity: number;
}

interface CreatePaymentRequestBody {
    items: CheckoutItemRequest[];
    customer_name?: string;
    fulfillment_type: 'pickup' | 'delivery';
    area?: string;
    address?: string;
    contact_phone?: string;
    contact_preference: 'phone' | 'email';
    notes?: string;
    payment_method_types?: string[];
}

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
}

function getSafePaymentMethods(requested?: string[]) {
    const methods = (Array.isArray(requested) ? requested : [])
        .filter((method): method is string => typeof method === 'string' && ALLOWED_PAYMENT_METHODS.has(method));
    return methods.length ? [...new Set(methods)] : ['gcash', 'paymaya', 'grab_pay', 'card'];
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
        console.error('Missing payment function configuration.');
        return jsonResponse({ error: 'Online payment isn\u2019t configured on the server yet.' }, 500);
    }

    const authorization = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: 'Please log in to check out.' }, 401);
    const user = userData.user;

    let body: CreatePaymentRequestBody;
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid request body.' }, 400);
    }

    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) {
        return jsonResponse({ error: 'Your cart is empty or too large.' }, 400);
    }
    if (body.fulfillment_type !== 'pickup' && body.fulfillment_type !== 'delivery') {
        return jsonResponse({ error: 'Please choose pickup or delivery.' }, 400);
    }
    if (!body.customer_name?.trim() || body.customer_name.trim().length < 2 || body.customer_name.trim().length > 120) {
        return jsonResponse({ error: 'Please provide your full name.' }, 400);
    }
    if (body.fulfillment_type === 'delivery' && (!body.area?.trim() || !body.address?.trim())) {
        return jsonResponse({ error: 'Please provide a delivery area and address.' }, 400);
    }
    if (body.contact_preference !== 'phone' && body.contact_preference !== 'email') {
        return jsonResponse({ error: 'Please choose a valid contact preference.' }, 400);
    }
    if (body.contact_preference === 'phone' && !body.contact_phone?.trim()) {
        return jsonResponse({ error: 'Please provide a phone number.' }, 400);
    }
    if (body.notes && body.notes.length > 300) {
        return jsonResponse({ error: 'Order notes are too long.' }, 400);
    }
    if (body.items.some((item) => typeof item?.product_id !== 'string'
        || !item.product_id.trim()
        || typeof item.quantity !== 'number'
        || !Number.isInteger(item.quantity)
        || item.quantity <= 0
        || item.quantity > 50)) {
        return jsonResponse({ error: 'Your cart contains an invalid quantity.' }, 400);
    }

    const { data: order, error: orderError } = await userClient.rpc('create_order_atomic', {
        p_customer_name: body.customer_name.trim(),
        p_fulfillment_type: body.fulfillment_type,
        p_area: body.fulfillment_type === 'delivery' ? body.area?.trim() : null,
        p_address: body.fulfillment_type === 'delivery' ? body.address?.trim() : null,
        p_contact_phone: body.contact_phone?.trim() || null,
        p_notes: body.notes?.trim() || null,
        p_items: body.items.map((item) => ({ product_id: item.product_id.trim(), quantity: item.quantity })),
        p_payment_provider: 'paymongo'
    });

    if (orderError || !order?.id) {
        console.error('create_order_atomic failed:', orderError);
        const rawMessage = orderError?.message ?? '';
        const schemaUnavailable = /create_order_atomic|PGRST202|does not exist|could not find the function/i.test(rawMessage);
        const outOfStock = /out of stock|unavailable/i.test(rawMessage);
        const message = schemaUnavailable
            ? 'The payment database upgrade is not installed yet. Apply the latest Supabase migrations, then retry.'
            : outOfStock
                ? 'One or more products are no longer available.'
                : rawMessage || 'Could not start your order. Please try again.';
        return jsonResponse({ error: message }, schemaUnavailable ? 503 : (outOfStock ? 409 : 500));
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: items, error: itemsError } = await admin
        .from('order_items')
        .select('product_name, unit_price, quantity')
        .eq('order_id', order.id);

    if (itemsError || !items?.length) {
        console.error('Could not load transactional order items:', itemsError);
        await admin.from('orders').update({ status: 'cancelled', payment_status: 'failed', cancel_reason: 'Payment setup failed' }).eq('id', order.id);
        return jsonResponse({ error: 'Could not prepare your payment. Please try again.' }, 500);
    }

    const paymongoRes = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic ' + btoa(paymongoSecretKey + ':')
        },
        body: JSON.stringify({
            data: {
                attributes: {
                    billing: { name: body.customer_name.trim(), email: user.email, phone: body.contact_phone?.trim() || undefined },
                    line_items: items.map((item) => ({
                        name: item.product_name,
                        amount: Math.round(Number(item.unit_price) * 100),
                        currency: 'PHP',
                        quantity: item.quantity
                    })),
                    payment_method_types: getSafePaymentMethods(body.payment_method_types),
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
        console.error('PayMongo error:', paymongoData);
        await admin.from('orders').update({ status: 'cancelled', payment_status: 'failed', cancel_reason: 'Payment provider rejected checkout' }).eq('id', order.id);
        return jsonResponse({ error: 'Could not start online payment. Please try again or choose Cash on Pickup/Delivery.' }, 502);
    }

    const session = paymongoData.data;
    const expiresAt = order.expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString();
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
        console.error('Could not record payment attempt:', updateError || attemptError);
        return jsonResponse({ error: 'Payment started, but we could not record the attempt. Please contact the studio if needed.' }, 500);
    }

    return jsonResponse({ orderId: order.id, checkoutUrl: session.attributes.checkout_url });
});
