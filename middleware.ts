import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Refreshes the auth session on every request so JWT expiry doesn't silently
// log the user out mid-session. @supabase/ssr required — without this, the
// server-side session goes stale while the browser still holds the old cookies
// and every navigation looks like "signed in / signed out flicker."
//
// Per the Supabase docs (https://supabase.com/docs/guides/auth/server-side/nextjs):
// You MUST call supabase.auth.getUser() here to refresh; do not attempt to modify
// the response cookies before this middleware runs.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value; },
        set(name: string, value: string, options: any) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
      cookieOptions: { name: "sb-fs-auth" },
    }
  );

  // Refresh the session — writes new tokens to cookies via the callbacks above
  await supabase.auth.getUser();
  return response;
}

// Run on every real request; skip Next.js internals + static assets
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff|woff2|ttf|otf)$).*)",
  ],
};
