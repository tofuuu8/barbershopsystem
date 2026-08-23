// ============================================================
// supabase/functions/create-payment-checkout/index.ts
// ============================================================
// Called by checkout.js when the customer picks an online payment
// method instead of Cash on Pickup/Delivery. Everything money-related
// happens here, server-side, on purpose:
//   - Product prices and stock are re-read from the database, never
//     trusted from the request body — a client could otherwise submit
//     any amount it wants.
//   - order_items are inserted immediately (before redirecting to
//     PayMongo), which reserves stock via the existing
//     trg_decrement_stock_on_order_item trigger — same behavior as a
//     Cash on Pickup/Delivery order. If the customer abandons payment,
//     payments_migration.sql's cleanup (or the webhook, on an explicit
//     failure) cancels the order and the existing cancellation trigger
//     returns that stock automatically.
//
// Deploy:
//   supabase functions deploy create-payment-checkout
//
// Required secrets (Dashboard -> Edge Functions -> Secrets, or via
// `supabase secrets set KEY=value`):
//   PAYMONGO_SECRET_KEY   sk_test_... (or sk_live_... once you go live)
//   SITE_URL              e.g. https://toughcuts.com  (no trailing slash;
//                          used to build the success/cancel redirect URLs)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
// by the Edge Functions runtime — no need to set those yourself.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Same coverage list as booking.js's BOOKING_HOME_AREAS / checkout.js's
// SHIPPING_AREAS — duplicated here too, on purpose: a delivery fee is
// part of the amount PayMongo charges, so it has to be verified
// server-side same as product prices, not trusted from the request body.
const SHIPPING_AREAS: Record<string, number> = {
    'san isidro': 80,
    'rodriguez': 100,
    'san mateo': 150,
    'marikina': 180,
    'antipolo': 200,
    'cainta': 200,
    'taytay': 220,
    'quezon city': 250
};

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
    payment_method_types?: string[]; // e.g. ['gcash','card','paymaya','grab_pay'] — defaults to all four below
}

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS_HEADERS });
    }
    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const paymongoSecretKey = Deno.env.get('PAYMONGO_SECRET_KEY');
    const siteUrl = Deno.env.get('SITE_URL');

    if (!paymongoSecretKey || !siteUrl) {
        console.error('Missing PAYMONGO_SECRET_KEY or SITE_URL secret.');
        return jsonResponse({ error: 'Online payment isn\u2019t configured on the server yet.' }, 500);
    }

    // Identify the caller from their own JWT (respects RLS / confirms
    // they're a real logged-in customer) before doing anything
    // privileged with the service-role client below.
    const authClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
        return jsonResponse({ error: 'Please log in to check out.' }, 401);
    }
    const user = userData.user;

    let body: CreatePaymentRequestBody;
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid request body.' }, 400);
    }

    if (!Array.isArray(body.items) || !body.items.length) {
        return jsonResponse({ error: 'Your cart is empty.' }, 400);
    }
    if (body.fulfillment_type !== 'pickup' && body.fulfillment_type !== 'delivery') {
        return jsonResponse({ error: 'Please choose pickup or delivery.' }, 400);
    }
    if (!body.customer_name?.trim() || body.customer_name.trim().length < 2) {
        return jsonResponse({ error: 'Please provide your full name.' }, 400);
    }
    if (body.fulfillment_type === 'delivery' && (!body.area || !body.address?.trim())) {
        return jsonResponse({ error: 'Please provide a delivery area and address.' }, 400);
    }
    if (body.contact_preference !== 'phone' && body.contact_preference !== 'email') {
        return jsonResponse({ error: 'Please choose a valid contact preference.' }, 400);
    }
    if (body.contact_preference === 'phone' && !body.contact_phone?.trim()) {
        return jsonResponse({ error: 'Please provide a phone number.' }, 400);
    }

    // Service-role client for everything privileged below — reading
    // authoritative product data and writing orders/order_items,
    // bypassing RLS deliberately since this function IS the trusted
    // boundary (we've already confirmed the caller's identity above).
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const requestedById = new Map<string, number>();
    for (const requested of body.items) {
        const productId = String(requested?.product_id ?? '').trim();
        const quantity = requested?.quantity;
        if (!productId || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
            return jsonResponse({ error: 'Invalid quantity in your cart.' }, 400);
        }
        requestedById.set(productId, (requestedById.get(productId) ?? 0) + quantity);
    }

    const productIds = [...requestedById.keys()];
    const { data: products, error: productsError } = await admin
        .from('products')
        .select('id, name, price, stock_quantity, is_active')
        .in('id', productIds);

    if (productsError) {
        console.error(productsError);
        return jsonResponse({ error: 'Could not verify your cart. Please try again.' }, 500);
    }

    const productsById = new Map((products ?? []).map((p) => [p.id, p]));
    const lineItems: { product_id: string; name: string; unit_price: number; quantity: number; line_total: number }[] = [];

    for (const [productId, quantity] of requestedById) {
        const product = productsById.get(productId);

        if (!product || !product.is_active) {
            return jsonResponse({ error: `A product in your cart is no longer available.` }, 409);
        }
        if (!Number.isInteger(product.stock_quantity) || product.stock_quantity <= 0 || quantity > product.stock_quantity) {
            return jsonResponse({ error: `Only ${product.stock_quantity} of ${product.name} left.` }, 409);
        }

        const unitPrice = Number(product.price);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            return jsonResponse({ error: `A product in your cart has an invalid price.` }, 500);
        }
        lineItems.push({
            product_id: product.id,
            name: product.name,
            unit_price: unitPrice,
            quantity,
            line_total: unitPrice * quantity
        });
    }

    const subtotal = lineItems.reduce((sum, i) => sum + i.line_total, 0);
    let deliveryFee = 0;
    if (body.fulfillment_type === 'delivery') {
        const areaKey = (body.area ?? '').toLowerCase().trim();
        if (!(areaKey in SHIPPING_AREAS)) {
            return jsonResponse({ error: 'Please select a valid delivery area.' }, 400);
        }
        deliveryFee = SHIPPING_AREAS[areaKey];
    }
    const totalPrice = subtotal + deliveryFee;

    // 1) Create the order in 'awaiting_payment' — nothing is confirmed
    //    yet, but inserting order_items right away reserves the stock
    //    (via the existing trigger) so it can't be sold out from under
    //    this customer while they're on the PayMongo page.
    const { data: order, error: orderError } = await admin
        .from('orders')
        .insert({
            user_id: user.id,
            customer_name: body.customer_name.trim(),
            fulfillment_type: body.fulfillment_type,
            area: body.fulfillment_type === 'delivery' ? body.area?.toLowerCase().trim() : null,
            address: body.fulfillment_type === 'delivery' ? body.address?.trim() : null,
            subtotal,
            total_price: totalPrice,
            contact_phone: body.contact_preference === 'phone' ? body.contact_phone?.trim() : null,
            notes: body.notes?.trim() || null,
            status: 'awaiting_payment',
            payment_status: 'unpaid',
            payment_provider: 'paymongo'
        })
        .select('id')
        .single();

    if (orderError || !order) {
        console.error(orderError);
        return jsonResponse({ error: 'Could not start your order. Please try again.' }, 500);
    }

    const { error: itemsError } = await admin.from('order_items').insert(
        lineItems.map((i) => ({
            order_id: order.id,
            product_id: i.product_id,
            product_name: i.name,
            unit_price: i.unit_price,
            quantity: i.quantity,
            line_total: i.line_total
        }))
    );

    if (itemsError) {
        console.error(itemsError);
        // Nothing was reserved (order_items never landed), so just
        // remove the empty order rather than leaving an orphaned row.
        await admin.from('orders').delete().eq('id', order.id);
        return jsonResponse({ error: 'Could not reserve your items. Please try again.' }, 500);
    }

    // 2) Create the PayMongo Checkout Session. reference_number is set
    //    to our own order id — the webhook looks orders up by this
    //    first, so it doesn't have to depend on the checkout session id
    //    round-tripping cleanly through every event payload shape.
    const paymongoRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic ' + btoa(paymongoSecretKey + ':')
        },
        body: JSON.stringify({
            data: {
                attributes: {
                    billing: { email: user.email, phone: body.contact_phone ?? undefined },
                    line_items: lineItems.map((i) => ({
                        name: i.name,
                        amount: Math.round(i.unit_price * 100), // PayMongo wants centavos
                        currency: 'PHP',
                        quantity: i.quantity
                    })),
                    payment_method_types: body.payment_method_types ?? ['gcash', 'paymaya', 'grab_pay', 'card'],
                    description: `Toughcuts order ${order.id}`,
                    reference_number: order.id,
                    send_email_receipt: true,
                    success_url: `${siteUrl}/checkout/checkout.html?order=${order.id}&payment=success`,
                    cancel_url: `${siteUrl}/checkout/checkout.html?order=${order.id}&payment=cancelled`
                }
            }
        })
    });

    const paymongoData = await paymongoRes.json();

    if (!paymongoRes.ok) {
        console.error('PayMongo error:', paymongoData);
        // Payment never started — release the reservation. Setting
        // status to 'cancelled' runs through the same trigger a manual
        // admin cancellation would, so the restock logic isn't
        // duplicated here.
        await admin.from('orders').update({ status: 'cancelled', payment_status: 'failed' }).eq('id', order.id);
        return jsonResponse({ error: 'Could not start online payment. Please try again or choose Cash on Pickup/Delivery.' }, 502);
    }

    const session = paymongoData.data;
    await admin.from('orders').update({ payment_reference: session.id }).eq('id', order.id);

    return jsonResponse({ orderId: order.id, checkoutUrl: session.attributes.checkout_url });
});