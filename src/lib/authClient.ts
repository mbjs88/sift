// Browser-side auth. The ONE place the client talks to Supabase Auth.
//
// Two jobs:
//   1. Google sign-in / sign-out via Supabase OAuth.
//   2. Mirror the session's access token into an `sb-access-token` cookie, so
//      the SSR endpoints (/api/ingest, /api/synthesize) and the PWA share-target
//      POST can authenticate the user — servers can't read localStorage.
//
// Uses PUBLIC_ build-time vars (the anon key is public by design). These are
// baked at build, separate from the wrangler [vars] the server reads at runtime.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = import.meta.env.PUBLIC_SUPABASE_URL as string;
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string;
  _client = createClient(url, key, {
    auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
  });
  // Keep the cookie in lockstep with the session for the whole app lifetime,
  // including silent token refreshes.
  _client.auth.onAuthStateChange((_event, session) => {
    writeTokenCookie(session?.access_token ?? null);
  });
  return _client;
}

// Call once on page load: hydrate the session from storage / OAuth redirect and
// seed the cookie. Returns true if a user is signed in.
export async function bootstrapAuth(): Promise<boolean> {
  const supa = browserSupabase();
  const { data } = await supa.auth.getSession();
  writeTokenCookie(data.session?.access_token ?? null);
  return !!data.session;
}

export async function signInWithGoogle(redirectPath = '/app'): Promise<void> {
  await browserSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${redirectPath}` },
  });
}

export async function signOut(): Promise<void> {
  await browserSupabase().auth.signOut();
  writeTokenCookie(null);
}

// Lax + Secure: same-origin navigations (including the PWA share-target POST,
// which is same-site) carry the cookie; cross-site requests do not.
function writeTokenCookie(token: string | null): void {
  if (token) {
    document.cookie =
      `sb-access-token=${encodeURIComponent(token)}; Path=/; Max-Age=3600; SameSite=Lax; Secure`;
  } else {
    document.cookie = 'sb-access-token=; Path=/; Max-Age=0; SameSite=Lax; Secure';
  }
}
