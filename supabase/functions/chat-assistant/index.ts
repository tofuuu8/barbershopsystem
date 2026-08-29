// ============================================
// TOUGHCUTS SUPPORT CHAT — Supabase Edge Function
// ============================================
// Handles the customer/guest side of "talk to a human" conversations
// started from the chat widget (frontend/js/main.js). Staff replies are
// posted from the admin Support page directly via supabaseClient (RLS +
// is_admin() — see the support_chat_conversations migration), not through
// this function.
//
// Deploy:
//   supabase functions deploy support-chat
//
// No new secrets needed — uses the same auto-provisioned SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY as chat-assistant.
//
// Called by frontend/js/main.js as:
//   POST {SUPABASE_URL}/functions/v1/support-chat
//   Authorization: Bearer <user's session token, or the anon key for guests>
//   Body varies by action:
//
//   { "action": "escalate", "transcript": [{role, content}, ...] }
//     -> creates a conversation (+ inserts the recent AI transcript as
//        context for staff), returns { conversationId, guestToken? }
//
//   { "action": "send", "conversationId": "...", "guestToken"?: "...", "content": "..." }
//     -> posts a customer message, returns { ok: true }
//
//   { "action": "poll", "conversationId": "...", "guestToken"?: "...", "after"?: "<ISO timestamp>" }
//     -> returns { messages: [{sender_type, content, created_at}, ...], status }
//
// `guestToken` proves ownership of a conversation for guests (who have no
// auth.uid()); logged-in customers are identified by their JWT instead and
// don't need to send one. Every action re-checks ownership server-side —
// the token/JWT is never trusted from the client without a DB lookup.
// ============================================

// Deno runtime types are supplied by Supabase's edge function environment.
// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const ALLOWED_ORIGIN = "*"; // tighten to your real domain before launch — see chat-assistant's note on this too

const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

// --------------------------------------------
// Service-role Postgres access (bypasses RLS — every check below is
// therefore done explicitly in code, not left to the database).
// --------------------------------------------
async function pgrestService(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY ?? "",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
        },
    });
    if (!res.ok) {
        throw new Error(`PostgREST ${path} failed: ${res.status} ${await res.text()}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

// --------------------------------------------
// Identity (same approach as chat-assistant — the gateway has already
// verified this is a genuine, unexpired Supabase JWT before we see it).
// --------------------------------------------
function decodeJwtPayload(token: string): any | null {
    try {
        const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "===".slice((base64.length + 3) % 4);
        return JSON.parse(atob(padded));
    } catch {
        return null;
    }
}

function getCustomerId(req: Request): string | null {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const payload = token ? decodeJwtPayload(token) : null;
    return payload?.role === "authenticated" && payload.sub ? payload.sub : null;
}

// Confirms the caller actually owns this conversation — either as the
// logged-in customer_id, or via a matching guest_token. Never trusts the
// client's say-so without this lookup.
async function loadOwnedConversation(
    conversationId: string,
    customerId: string | null,
    guestToken: string | null,
): Promise<any | null> {
    const rows = await pgrestService(
        `support_conversations?id=eq.${encodeURIComponent(conversationId)}&select=id,customer_id,guest_token,status`,
    );
    const convo = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!convo) return null;

    if (customerId && convo.customer_id === customerId) return convo;
    if (!customerId && guestToken && convo.guest_token === guestToken) return convo;
    return null;
}

// --------------------------------------------
// Actions
// --------------------------------------------
async function handleEscalate(req: Request, body: any): Promise<Response> {
    const customerId = getCustomerId(req);
    const transcript: any[] = Array.isArray(body?.transcript) ? body.transcript.slice(-12) : [];

    const guestToken = customerId ? null : crypto.randomUUID();

    const created = await pgrestService("support_conversations", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
            customer_id: customerId,
            guest_token: guestToken,
        }),
    });
    const conversation = Array.isArray(created) ? created[0] : created;
    if (!conversation?.id) {
        return jsonResponse({ error: "Could not start a conversation. Please try again." }, 500);
    }

    // Seed the conversation with recent AI chat context (as 'system'
    // messages) so staff aren't starting cold.
    if (transcript.length) {
        const seedMessages = transcript.map((m: any) => ({
            conversation_id: conversation.id,
            sender_type: "system",
            content: `[Earlier with AI assistant — ${m.role === "assistant" ? "Toughcuts AI" : "Customer"}]: ${String(m.content || "").slice(0, 1000)}`,
        }));
        try {
            await pgrestService("support_messages", {
                method: "POST",
                body: JSON.stringify(seedMessages),
            });
        } catch (err) {
            console.error("Failed to seed transcript (non-fatal):", err);
        }
    }

    return jsonResponse({
        conversationId: conversation.id,
        guestToken: guestToken ?? undefined,
    });
}

async function handleSend(req: Request, body: any): Promise<Response> {
    const conversationId = String(body?.conversationId || "");
    const guestToken = body?.guestToken ? String(body.guestToken) : null;
    const content = String(body?.content || "").trim().slice(0, 4000);

    if (!conversationId || !content) {
        return jsonResponse({ error: "Missing conversationId or content" }, 400);
    }

    const customerId = getCustomerId(req);
    const convo = await loadOwnedConversation(conversationId, customerId, guestToken);
    if (!convo) {
        return jsonResponse({ error: "Conversation not found." }, 404);
    }
    if (convo.status === "closed") {
        return jsonResponse({ error: "This conversation has been closed by our team." }, 409);
    }

    await pgrestService("support_messages", {
        method: "POST",
        body: JSON.stringify({
            conversation_id: conversationId,
            sender_type: "customer",
            sender_id: customerId,
            content,
        }),
    });

    await pgrestService(`support_conversations?id=eq.${encodeURIComponent(conversationId)}`, {
        method: "PATCH",
        body: JSON.stringify({ last_message_at: new Date().toISOString() }),
    });

    return jsonResponse({ ok: true });
}

async function handlePoll(req: Request, body: any): Promise<Response> {
    const conversationId = String(body?.conversationId || "");
    const guestToken = body?.guestToken ? String(body.guestToken) : null;
    const after = body?.after ? String(body.after) : null;

    if (!conversationId) {
        return jsonResponse({ error: "Missing conversationId" }, 400);
    }

    const customerId = getCustomerId(req);
    const convo = await loadOwnedConversation(conversationId, customerId, guestToken);
    if (!convo) {
        return jsonResponse({ error: "Conversation not found." }, 404);
    }

    // Only 'staff' replies go back to the customer widget. 'system'
    // messages are the seeded AI-transcript context from handleEscalate —
    // that's for staff's eyes in the admin panel, not something to
    // re-display to the customer as if it were a new message.
    const filter = after
        ? `&created_at=gt.${encodeURIComponent(after)}`
        : "";
    const messages = await pgrestService(
        `support_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_type=eq.staff${filter}&select=sender_type,content,created_at&order=created_at.asc`,
    );

    return jsonResponse({ messages: messages || [], status: convo.status });
}

// --------------------------------------------
// Handler
// --------------------------------------------
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    try {
        switch (body?.action) {
            case "escalate":
                return await handleEscalate(req, body);
            case "send":
                return await handleSend(req, body);
            case "poll":
                return await handlePoll(req, body);
            default:
                return jsonResponse({ error: "Unknown action" }, 400);
        }
    } catch (err) {
        console.error("support-chat error:", err);
        return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
    }
});