// ============================================
// SUPABASE CLIENT
// ============================================
// One shared client for the whole site. Load this AFTER the Supabase
// library script tag and BEFORE main.js (and before any page script
// that calls supabaseClient, like login.js / signup.js / cart.js).
//
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="../js/supabase.js"></script>
//   <script src="../js/main.js"></script>
//
// Replace the two placeholders below with your project's own values —
// find them in the Supabase Dashboard under
// Project Settings -> API -> "Project URL" and "anon public" key.
//
// These are safe to expose in client-side code (that's what the anon
// key is for) as long as Row Level Security is enabled on any tables
// you add later.
const SUPABASE_URL = 'https://paizxiytgsoipoxdshxe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhaXp4aXl0Z3NvaXBveGRzaHhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxMTA4NTgsImV4cCI6MjEwMjY4Njg1OH0.ZNVLOUj_cPbIt32RPBC6_JTfjj8hWzIpLz82knMhFUI';

// --------------------------------------------
// "Remember me" support
// --------------------------------------------
// Supabase persists sessions to localStorage by default, which survives
// browser restarts no matter what the login page's checkbox says. To make
// unchecking "Remember me" actually mean something (session-only — cleared
// when the browser/tab closes), the client below is given a custom storage
// adapter that picks localStorage or sessionStorage per call, based on a
// small preference flag (toughcuts_remember) that login.js sets right
// before signing in.
//
// Defaults to localStorage (remembered) whenever the flag hasn't been set
// yet — e.g. during signup, or the password-recovery chain — so every flow
// other than an explicit "unchecked" login keeps behaving exactly as
// before.
const REMEMBER_FLAG_KEY = 'toughcuts_remember';

function getActiveAuthStorage() {
    return localStorage.getItem(REMEMBER_FLAG_KEY) === 'false'
        ? window.sessionStorage
        : window.localStorage;
}

const dynamicAuthStorage = {
    getItem: (key) => getActiveAuthStorage().getItem(key),
    setItem: (key, value) => getActiveAuthStorage().setItem(key, value),
    removeItem: (key) => getActiveAuthStorage().removeItem(key)
};

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storage: dynamicAuthStorage,
        persistSession: true,
        autoRefreshToken: true
    }
});