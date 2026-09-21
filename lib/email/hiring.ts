// Applicant confirmation email. Resend, same convention as lib/email/invite.ts:
// RESEND_API_KEY + HIRING_EMAIL_FROM (falls back to INVITE_EMAIL_FROM).
// No key → no email, and the caller logs that it wasn't sent.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function sendApplicantConfirmation(args: {
  to: string;
  name: string;
  house: string;
  lang: "es" | "en";
  contact: string;
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, error: "RESEND_API_KEY not set" };
  const from = process.env.HIRING_EMAIL_FROM || process.env.INVITE_EMAIL_FROM;
  if (!from) return { sent: false, error: "HIRING_EMAIL_FROM not set" };
  const first = (args.name || "").trim().split(/\s+/)[0] || "";
  const es = args.lang !== "en";
  const subject = es ? `${args.house} — hemos recibido tu candidatura` : `${args.house} — we've received your application`;
  const body = es
    ? [
        `Hola ${first},`,
        `Gracias por tu candidatura para ${args.house}. La hemos recibido bien.`,
        `La leemos personalmente, sin filtros automáticos de descarte, y te escribimos en unos días.`,
        `Si quieres añadir algo o que borremos tus datos, responde a este correo o escribe a ${args.contact}.`,
        `Un saludo,<br>Boris y el equipo de ${args.house}`,
      ]
    : [
        `Hi ${first},`,
        `Thanks for applying to ${args.house}. Your application has arrived.`,
        `We read every one ourselves, with no automatic rejection filters, and we'll write to you within a few days.`,
        `If you want to add something or have your details deleted, reply to this email or write to ${args.contact}.`,
        `Best,<br>Boris and the ${args.house} team`,
      ];
  const html = `<!doctype html><html><body style="margin:0;background:#faf8f5;font-family:Georgia,serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px"><tr><td style="font-size:16px;line-height:1.6">
${body.map((p) => `<p style="margin:0 0 14px">${p.includes("<br>") ? p.split("<br>").map(esc).join("<br>") : esc(p)}</p>`).join("\n")}
</td></tr></table></td></tr></table></body></html>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: [args.to], reply_to: args.contact, subject, html }),
    });
    if (!r.ok) return { sent: false, error: `resend ${r.status}` };
    return { sent: true };
  } catch (e: any) {
    return { sent: false, error: e?.message || "send failed" };
  }
}
