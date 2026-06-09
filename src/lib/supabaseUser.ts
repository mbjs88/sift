// RLS-scoped Supabase access for the Astro app (producer side).
//
// This is the OPPOSITE of db.ts: it uses the public ANON key plus the signed-in
// user's JWT, so every read and write runs through Row-Level Security as that
// user. The service-role key never touches this path — it lives only in the
// consumer Worker. If a request has no valid token, the caller gets nothing.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface UserEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

// Anon client that carries the user's access token on every request. PostgREST
// reads the JWT, sets auth.uid(), and RLS does the rest.
export function userClient(env: UserEnv, token: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Pull the access token from a request. The PWA share-target POST can't set an
// Authorization header, so we also accept the Supabase session cookie that the
// signed-in browser already carries.
export function bearerFromRequest(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();

  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  const m = cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// The account that newly-ingested data belongs to. For now: the caller's oldest
// account (their personal brain on signup). Family/enterprise switching comes
// later — when it does, this is the single place to honour an explicit choice.
// Returns null if the user belongs to no account (RLS yields zero rows).
export async function resolveActiveAccount(supa: SupabaseClient): Promise<string | null> {
  const { data, error } = await supa
    .from('accounts')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].id as string;
}
