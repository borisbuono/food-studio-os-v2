import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Refreshes the Supabase auth session on every request so JWT expiry doesn't
// silently log the user out. Uses the getAll/setAll pattern per Supabase's
// official docs (https://supabase.com/docs/guides/auth/server-side/nextjs) —
// preserves ALL auth cookies (including split token cookies over 4KB) in one
// atomic response update.
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
      cookieOptions: { name: "sb-fs-auth" },
    }
  );

  // Refreshes the session. Do NOT put any code between createServerClient and this call.
  await supabase.auth.getUser();
  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on every real request — exclude Next.js internals + static file extensions
    "/((?!_next/static|_next/image|favicon.ico|icon.png|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|json|webmanifest|xml|txt|woff|woff2|ttf|otf|mp3|mp4|wav|ogg|webm)$).*)",
  ],
};
