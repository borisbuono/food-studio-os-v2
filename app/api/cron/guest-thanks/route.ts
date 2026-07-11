import { NextRequest, NextResponse } from "next/server";
import { guestServiceClient } from "@/lib/guest/serviceClient";
import { signGuestToken } from "@/lib/guest/token";
import { sendGuestEmail, thankYouEmailHtml } from "@/lib/guest/email";
import { getGuestBrand } from "@/lib/guest/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Daily post-visit thank-you sender.
//
// Selects yesterday's bookings that:
//   * were seated (status in seated | done)
//   * have a guest_id with an email
//   * haven't already had a thank-you sent
//
// Sends the thanks email with a signed link to /m/[slug]/thanks?token=…
// Thanks-token flag lives in bookings.notes as a soft marker
// ("[thanks_sent] ISO-timestamp") to avoid a schema change here.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== "Bearer " + secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const sb = guestServiceClient;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: bookings } = await sb.from("bookings")
    .select("id,restaurant_id,guest_id,status,notes,service_date")
    .eq("service_date", yesterday)
    .in("status", ["seated", "done"]);

  const rows = (bookings || []) as any[];
  let sent = 0, skipped = 0, failed = 0;

  for (const b of rows) {
    if (!b.guest_id) { skipped++; continue; }
    if ((b.notes || "").includes("[thanks_sent]")) { skipped++; continue; }

    const [{ data: r }, { data: g }] = await Promise.all([
      sb.from("restaurants").select("id,name,public_slug").eq("id", b.restaurant_id).maybeSingle(),
      sb.from("guests").select("id,name,email").eq("id", b.guest_id).maybeSingle(),
    ]);
    if (!r?.public_slug || !g?.email) { skipped++; continue; }

    const brand = getGuestBrand(r.public_slug, r.name || undefined);
    let link = "";
    try {
      const token = signGuestToken({ g: g.id, b: b.id, r: r.id, k: "thanks" });
      link = `${originFromReq(req)}/m/${r.public_slug}/thanks?token=${encodeURIComponent(token)}`;
    } catch { skipped++; continue; }

    const res = await sendGuestEmail({
      to: g.email,
      subject: `Thank you for visiting ${r.name || brand.restaurantName}`,
      html: thankYouEmailHtml({
        venueName: r.name || brand.restaurantName,
        guestName: (g.name || "").split(" ")[0] || (g.name || ""),
        feedbackLink: link,
        brandAccent: brand.accent,
      }),
    });
    if (!res.ok) { failed++; continue; }

    await sb.from("bookings").update({
      notes: `${b.notes || ""}\n[thanks_sent] ${new Date().toISOString()}`.trim(),
    }).eq("id", b.id);
    sent++;
  }

  return NextResponse.json({ ok: true, day: yesterday, sent, skipped, failed, total: rows.length });
}

function originFromReq(req: NextRequest): string {
  const u = new URL(req.url);
  const forwarded = req.headers.get("x-forwarded-host") || u.host;
  const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return `${proto}://${forwarded}`;
}
