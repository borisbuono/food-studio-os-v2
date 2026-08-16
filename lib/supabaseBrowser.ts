import { createBrowserClient } from "@supabase/ssr";
import { browserAuthCookieOptions } from "@/lib/authCookies";

// THE single browser auth client. cookieOptions derived from
// window.location.hostname so prod cookies get domain=.foodstudio.ai
// + Secure + SameSite=Lax (survives Safari ITP + apex/www split); dev/preview
// stays host-only.
export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { cookieOptions: browserAuthCookieOptions() }
);
