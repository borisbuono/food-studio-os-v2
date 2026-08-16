import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authCookieOptions } from "@/lib/authCookies";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const cookieOpts = authCookieOptions(request.headers.get("host"));

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
            supabaseResponse.cookies.set(name, value, { ...cookieOpts, ...options })
          );
        },
      },
      cookieOptions: cookieOpts,
    }
  );

  await supabase.auth.getUser();
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!auth/|_next/static|_next/image|favicon.ico|icon.png|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|json|webmanifest|xml|txt|woff|woff2|ttf|otf|mp3|mp4|wav|ogg|webm)$).*)",
  ],
};
