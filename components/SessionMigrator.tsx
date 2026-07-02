"use client";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

// Legacy sign-ins (pre-@supabase/ssr switch on 2026-06-09) stored the session in
// localStorage only. createBrowserClient reads localStorage for backward compat
// but never writes cookies until the next sign-in. Symptom: the "boris" chip
// shows in the top-nav (from localStorage session) but every server-side auth
// check returns null (cookies empty) → all API routes 401.
//
// Fix: on mount, if we have a session, call setSession() explicitly. That
// triggers the @supabase/ssr cookie adapter to write the tokens into
// sb-fs-auth cookies. From that point on, server + client agree on identity.
//
// Idempotent — if cookies already exist, setSession is a no-op refresh.
export default function SessionMigrator() {
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabaseBrowser.auth.getSession();
        if (!data.session) return;
        // Explicitly set the session, which writes to cookies via the @supabase/ssr adapter
        await supabaseBrowser.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        // Also trigger a refresh so any expiring token gets rotated + written back
        await supabaseBrowser.auth.refreshSession();
      } catch {
        // best-effort
      }
    })();
  }, []);
  return null;
}
