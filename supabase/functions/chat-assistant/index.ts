// ============================================
// TOUGHCUTS AI CHAT ASSISTANT — Supabase Edge Function (Gemini)
// ============================================
// Purpose: keeps the Gemini API key server-side (never shipped to the
// browser) while letting the site's chat widget get real AI answers.
//
// Deploy:
//   supabase functions deploy chat-assistant
//
// Set the secret once (get a free key at https://aistudio.google.com/apikey —
// no credit card required):
//   supabase secrets set GEMINI_API_KEY=AIza...
//
// The function is called by frontend/js/main.js as:
//   POST {SUPABASE_URL}/functions/v1/chat-assistant
//   Authorization: Bearer <SUPABASE_ANON_KEY>   (site's public anon key)
//   Body: { "messages": [{ "role": "user"|"assistant", "content": "..." }] }
//
// Response: { "reply": "..." }  or  { "error": "..." }
// ============================================

// Deno runtime types are supplied by Supabase's edge function environment.
// deno-lint-ignore-file no-explicit-any

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

// Auto-provisioned by Supabase on every Edge Function — no need to set
// these as secrets yourself. Used read-only, via PostgREST, respecting
// the same RLS policies your public pages already rely on.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

// gemini-3.5-flash-lite: current free-tier-eligible Flash-Lite model
// (~15 RPM / 1,500 requests per day, no credit card) — a good fit for a
// high-volume, low-complexity FAQ-style chat widget.
// Note: gemini-2.5-flash-lite was retired for new API keys (404 as of
// Aug 2026) — Google now points new users at this model instead.
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// --------------------------------------------
// CORS
// --------------------------------------------
// Restrict this to your real domain(s) in production — "*" is fine while
// you're developing locally.
const ALLOWED_ORIGIN = "*";

const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --------------------------------------------
// System prompt — what the assistant knows and how it should behave.
// Keep this in sync with the real site. Anything you don't want it
// improvising about, tell it explicitly to defer to a page/link instead.
// --------------------------------------------
const SYSTEM_PROMPT = `
You are the Toughcuts AI assistant, embedded as a chat widget on the
Toughcuts barbershop & grooming studio website. Your one job is to help
visitors use the website and point them to the right place — you are a
site guide and light customer-service agent, not a general-purpose
chatbot.

ABOUT TOUGHCUTS
- Premium barbershop & grooming studio brand: "Precision cuts. Premium
  style. Pure confidence."
- Business hours: Mon–Fri 9:00 AM–8:00 PM, Saturday 9:00 AM–6:00 PM,
  Sunday closed.
- Contact: info@toughcuts.com
- Social: Instagram @_toughcuts

SITE MAP — this is the COMPLETE and ONLY list of valid internal links.
When you want to point someone to a page, write it as a markdown link
using the EXACT path shown here, e.g. [Book Now](booking/booking.html).
Never invent a path that isn't in this list, never use a full URL
(no "https://..."), and never link to a path outside this list — the
website will only render links that match one of these exactly:
- Home: index.html
- Studio (locations/interior): studio/studio.html
- Products (grooming products / shop): products/products.html
- Services (haircuts, beard grooming, etc.): services/services.html
- About Us: aboutus/about.html
- Book an appointment: booking/booking.html
- Log in: login/login.html — Sign up: login/signup.html
- Cart: cart/cart.html — Checkout: checkout/checkout.html
- Account: account/account.html
- My Appointments: myappointments/myappointments.html
- My Orders: myorders/myorders.html

WHAT YOU CAN HELP WITH
- Explaining how to book an appointment, create an account, or check out.
- Answering questions about current services, products, and barbers using
  the CURRENT CATALOG DATA block below — it's fetched live from the
  database, so treat it as ground truth (it's more current than anything
  else in this prompt).
- Pointing users to the right page for anything not covered in the
  catalog data (studio locations/addresses, promotions, policies).
- General grooming questions in a friendly, brief way (e.g. "how often
  should I get a haircut") — keep it short, this is a chat bubble, not an
  essay.
- Reassuring/help with account issues at a high level (e.g. "forgot my
  password" → point to the login page's reset flow).

WHAT YOU MUST NOT DO
- Do not invent services, products, barbers, prices, or fees beyond what
  appears in the CURRENT CATALOG DATA block. If something isn't listed
  there (e.g. an item a customer asks about that doesn't appear), say you
  don't see that currently and point to the relevant page instead of
  guessing.
- Do not invent studio street addresses or staff details beyond what's in
  the catalog data — point to the Studio or About Us page instead.
- Do not process payments, bookings, or account changes yourself — you
  can only guide the user to the page where they can do that themselves.
- Do not claim to know a user's order status, cart contents, or account
  details — you have no access to their account.

STYLE
- Warm, concise, on-brand (confident, modern, a little bit "premium
  barbershop"). 1–4 sentences per reply unless more detail is clearly
  needed.
- No markdown headers or bullet-heavy formatting — this renders in a
  small chat bubble. Short prose, occasional short list if truly helpful.
  Markdown links (for internal pages only, per SITE MAP above) are fine.
- If you don't know something, say so plainly and redirect rather than
  guessing.
`.trim();

// --------------------------------------------
// Live catalog data — fetched from Postgres via PostgREST, using the same
// anon key + RLS policies your public pages already rely on (only
// is_active rows are readable by anon/public, per your existing policies).
// Cached briefly in memory to avoid re-querying on every single message.
// --------------------------------------------
const CATALOG_TTL_MS = 3 * 60 * 1000; // 3 minutes
let catalogCache: { text: string; fetchedAt: number } | null = null;

async function pgrest(path: string): Promise<any[]> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: {
            apikey: SUPABASE_ANON_KEY ?? "",
            Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
        },
    });
    if (!res.ok) {
        throw new Error(`PostgREST ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
}

function peso(n: any): string {
    const num = Number(n);
    return Number.isFinite(num) ? `₱${num.toFixed(0)}` : "₱?";
}

async function buildCatalogBlock(): Promise<string> {
    const [services, products, barbers, areas] = await Promise.all([
        pgrest("services?is_active=eq.true&select=name,gender,description,price,duration_minutes&order=gender,name"),
        pgrest("products?is_active=eq.true&select=name,brand,category,price,description,stock_quantity,low_stock_threshold&order=category,name"),
        pgrest("barbers?is_active=eq.true&select=name,title,specialties,experience,rating,reviews,schedule&order=name"),
        pgrest("delivery_areas?is_active=eq.true&select=label,fee&order=fee"),
    ]);

    const servicesText = services.length
        ? services.map((s: any) =>
              `- ${s.name} (${s.gender}) — ${peso(s.price)}, ${s.duration_minutes} min. ${s.description ?? ""}`.trim()
          ).join("\n")
        : "(no active services currently listed)";

    const productsText = products.length
        ? products.map((p: any) => {
              const threshold = p.low_stock_threshold ?? 5;
              const stockLabel = p.stock_quantity <= 0
                  ? "Out of stock"
                  : p.stock_quantity <= threshold
                  ? "Low stock"
                  : "In stock";
              const brand = p.brand ? ` (${p.brand})` : "";
              return `- ${p.name}${brand} — ${peso(p.price)} — ${stockLabel}. ${p.description ?? ""}`.trim();
          }).join("\n")
        : "(no active products currently listed)";

    const barbersText = barbers.length
        ? barbers.map((b: any) => {
              const bits = [
                  b.title || null,
                  b.experience ? `${b.experience} yrs experience` : null,
                  Number(b.rating) > 0 ? `${b.rating}★ (${b.reviews ?? 0} reviews)` : null,
              ].filter(Boolean).join(", ");
              const specialties = b.specialties ? ` Specialties: ${b.specialties}.` : "";
              const schedule = b.schedule ? ` Schedule: ${b.schedule}.` : "";
              return `- ${b.name}${bits ? ` — ${bits}.` : "."}${specialties}${schedule}`;
          }).join("\n")
        : "(no active barbers currently listed)";

    const areasText = areas.length
        ? areas.map((a: any) => `- ${a.label} — ${peso(a.fee)} delivery/travel fee`).join("\n")
        : "(no home-service delivery areas currently listed)";

    return `
CURRENT CATALOG DATA (live from the database as of this conversation — this
is more current and more trustworthy than anything else in this prompt;
never invent items, prices, or fees beyond what's listed here):

SERVICES:
${servicesText}

PRODUCTS:
${productsText}

BARBERS:
${barbersText}

HOME SERVICE — DELIVERY/TRAVEL FEES BY AREA:
${areasText}
`.trim();
}

async function getCatalogBlock(): Promise<string> {
    const now = Date.now();
    if (catalogCache && now - catalogCache.fetchedAt < CATALOG_TTL_MS) {
        return catalogCache.text;
    }
    try {
        const text = await buildCatalogBlock();
        catalogCache = { text, fetchedAt: now };
        return text;
    } catch (err) {
        console.error("Failed to fetch catalog data:", err);
        // Serve stale cache rather than nothing, if we have it.
        return catalogCache?.text ?? "";
    }
}

// --------------------------------------------
// Helpers
// --------------------------------------------
function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function sanitizeMessages(input: unknown): ChatMessage[] | null {
    if (!Array.isArray(input)) return null;

    const cleaned: ChatMessage[] = [];
    for (const item of input) {
        if (!item || typeof item !== "object") continue;
        const role = (item as any).role;
        const content = (item as any).content;
        if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
            continue;
        }
        const trimmed = content.trim().slice(0, 4000); // guard against huge payloads
        if (!trimmed) continue;
        cleaned.push({ role, content: trimmed });
    }

    // Keep only the most recent turns — plenty for a guided FAQ-style chat
    // and keeps token usage (and free-tier quota) predictable.
    const MAX_TURNS = 12;
    return cleaned.slice(-MAX_TURNS);
}

// Gemini uses "user" / "model" instead of "user" / "assistant", and wraps
// text in a `parts` array.
function toGeminiContents(messages: ChatMessage[]) {
    return messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
    }));
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

    if (!GEMINI_API_KEY) {
        console.error("Missing GEMINI_API_KEY secret");
        return jsonResponse(
            { error: "Chat assistant is not configured yet. Please try again later." },
            500,
        );
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const messages = sanitizeMessages(body?.messages);
    if (!messages || messages.length === 0) {
        return jsonResponse({ error: "No valid messages provided" }, 400);
    }

    try {
        const catalogBlock = await getCatalogBlock();
        const fullSystemPrompt = catalogBlock
            ? `${SYSTEM_PROMPT}\n\n${catalogBlock}`
            : SYSTEM_PROMPT; // catalog fetch failed and no cache yet — degrade gracefully

        const geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: fullSystemPrompt }] },
                contents: toGeminiContents(messages),
                generationConfig: {
                    maxOutputTokens: 400,
                    temperature: 0.6,
                },
            }),
        });

        if (!geminiRes.ok) {
            const errText = await geminiRes.text();
            console.error("Gemini API error:", geminiRes.status, errText);

            // 429 = free-tier rate limit hit — worth a distinct, honest message.
            if (geminiRes.status === 429) {
                return jsonResponse(
                    { error: "We're getting a lot of chats right now — please try again in a minute." },
                    429,
                );
            }
            return jsonResponse(
                { error: "The assistant is having trouble right now. Please try again in a moment." },
                502,
            );
        }

        const data = await geminiRes.json();
        const reply = (data?.candidates?.[0]?.content?.parts || [])
            .map((p: any) => p.text || "")
            .join("\n")
            .trim();

        if (!reply) {
            // Most common cause: the response was blocked by a safety filter
            // (check data.candidates[0].finishReason if you need to debug).
            return jsonResponse(
                { error: "The assistant didn't return a response. Please try rephrasing." },
                502,
            );
        }

        return jsonResponse({ reply });
    } catch (err) {
        console.error("Unexpected error calling Gemini:", err);
        return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
    }
});