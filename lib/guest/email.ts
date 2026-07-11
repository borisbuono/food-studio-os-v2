// Guest email dispatch — thin façade so this commit doesn't couple to a
// specific provider. When RESEND_API_KEY is present, we call Resend's REST
// API; otherwise we log to server console (dev fallback) and return ok:true
// so the booking flow itself doesn't fail on missing infra.
//
// Wire your provider by setting:
//   RESEND_API_KEY=re_xxx
//   GUEST_EMAIL_FROM="Bistrot Mondo <hello@bistrot-mondo.example>"
//
// The confirmation and thank-you email bodies are plain HTML built here so
// they're identical across providers.

type SendArgs = { to: string; subject: string; html: string; from?: string };

export async function sendGuestEmail(args: SendArgs): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = args.from || process.env.GUEST_EMAIL_FROM || "Food Studios <no-reply@foodstudios.local>";
  if (!key) {
    // dev fallback — don't block the booking flow when the SMTP relay isn't set
    console.log("[guest-email dev] would send", { to: args.to, subject: args.subject, from });
    return { ok: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ from, to: [args.to], subject: args.subject, html: args.html }),
    });
    if (!res.ok) return { ok: false, error: `resend ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "email dispatch failed" };
  }
}

export function confirmationEmailHtml(o: {
  venueName: string; guestName: string; dateLabel: string; timeLabel: string;
  partySize: number; preferencesLink: string; brandAccent: string;
}): string {
  const { venueName, guestName, dateLabel, timeLabel, partySize, preferencesLink, brandAccent } = o;
  return `<!doctype html>
<html><body style="font-family: Georgia, serif; background:#EFEEEB; margin:0; padding:32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#FBF7EF; padding:36px; border-radius:6px;">
    <tr><td>
      <p style="font-family: 'DM Mono', monospace; font-size:11px; letter-spacing:0.28em; text-transform:uppercase; color:${brandAccent}; margin:0 0 8px;">Booking confirmed</p>
      <h1 style="font-family: Fraunces, Georgia, serif; font-weight:300; font-size:28px; color:#171511; margin:0 0 24px;">See you at ${venueName}</h1>
      <p style="font-size:17px; line-height:1.5; color:#3A352D; margin:0 0 20px;">${guestName ? guestName + ", " : ""}your table is booked for <strong>${dateLabel}</strong> at <strong>${timeLabel}</strong> for a party of <strong>${partySize}</strong>.</p>
      <p style="font-size:15px; line-height:1.55; color:#3A352D; margin:0 0 28px;">If you'd like to share any allergies, dietary needs, or notes for the visit, take a moment to update your preferences:</p>
      <p style="margin:0 0 32px;"><a href="${preferencesLink}" style="display:inline-block; background:${brandAccent}; color:#FBF7EF; text-decoration:none; padding:12px 22px; border-radius:999px; font-family: Inter, sans-serif; font-size:13px; letter-spacing:0.04em;">Share preferences</a></p>
      <p style="font-family: 'DM Mono', monospace; font-size:10px; letter-spacing:0.2em; text-transform:uppercase; color:#7A7A75; margin:24px 0 0;">A Food Studios venue</p>
    </td></tr>
  </table>
</body></html>`;
}

export function thankYouEmailHtml(o: {
  venueName: string; guestName: string; feedbackLink: string; brandAccent: string;
}): string {
  const { venueName, guestName, feedbackLink, brandAccent } = o;
  return `<!doctype html>
<html><body style="font-family: Georgia, serif; background:#EFEEEB; margin:0; padding:32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#FBF7EF; padding:36px; border-radius:6px;">
    <tr><td>
      <p style="font-family: 'DM Mono', monospace; font-size:11px; letter-spacing:0.28em; text-transform:uppercase; color:${brandAccent}; margin:0 0 8px;">Thank you</p>
      <h1 style="font-family: Fraunces, Georgia, serif; font-weight:300; font-size:28px; color:#171511; margin:0 0 20px;">Thank you for visiting ${venueName}</h1>
      <p style="font-size:16px; line-height:1.55; color:#3A352D; margin:0 0 24px;">${guestName ? guestName + ", " : ""}we'd love to hear how the visit was. A minute of your time helps the kitchen and the floor.</p>
      <p style="margin:0 0 32px;"><a href="${feedbackLink}" style="display:inline-block; background:${brandAccent}; color:#FBF7EF; text-decoration:none; padding:12px 22px; border-radius:999px; font-family: Inter, sans-serif; font-size:13px; letter-spacing:0.04em;">Share your visit</a></p>
      <p style="font-family: 'DM Mono', monospace; font-size:10px; letter-spacing:0.2em; text-transform:uppercase; color:#7A7A75; margin:24px 0 0;">A Food Studios venue</p>
    </td></tr>
  </table>
</body></html>`;
}
