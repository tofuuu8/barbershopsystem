import { createClient } from 'jsr:@supabase/supabase-js@2';

function response(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

    const configuredSecret = Deno.env.get('CRON_SECRET');
    const suppliedSecret = req.headers.get('x-cron-secret');
    if (!configuredSecret) return response({ error: 'Cron endpoint is not configured.' }, 500);
    if (suppliedSecret !== configuredSecret) return response({ error: 'Unauthorized' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) return response({ error: 'Server configuration is incomplete.' }, 500);

    const admin = createClient(url, serviceRoleKey);
    const { data, error } = await admin.rpc('expire_unpaid_orders');
    if (error) {
        console.error('expire_unpaid_orders failed:', error);
        return response({ error: 'Could not expire unpaid orders.' }, 500);
    }
    return response({ expired: Number(data || 0) });
});
