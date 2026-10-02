/**
 * Email channel (Comms, 2026-10-02) — pure-logic checks that run without a
 * Gmail token: header parsing, the reply MIME, the thread-safety of the
 * In-Reply-To / References headers. E2 adds the rule classifier here.
 *   sh scripts/test_email_channel.sh
 */
import { parseAddress, parseAddressList, buildReplyMime, toBase64Url, encodeHeaderWord, GMAIL_SCOPES } from "../lib/email/gmail";
import { ruleClassify, type ClassifyInput } from "../lib/email/rules";
import { canonical, hashableAction } from "../lib/chef/canonical";
import { actionHash, CONFIRM_REQUIRED } from "../lib/chef/confirm";
import { approveEmailAction, replyTarget } from "../lib/email/reply";
import { createHash } from "node:crypto";

let fails = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}
function truthy(name: string, got: unknown) { eq(name, !!got, true); }

eq("address: name <addr>", parseAddress('Harmke de Vries <Harmke@Example.COM>'), { address: "harmke@example.com", name: "Harmke de Vries" });
eq("address: quoted name", parseAddress('"Servifruit, S.L." <ventas@servifruit.es>'), { address: "ventas@servifruit.es", name: "Servifruit, S.L." });
eq("address: bare", parseAddress("info@bistro-mondo.com"), { address: "info@bistro-mondo.com", name: null });
eq("address: empty", parseAddress(""), { address: null, name: null });
eq("list", parseAddressList("a@x.com, B <b@y.com>;"), ["a@x.com", "b@y.com"]);

const mime = buildReplyMime({
  from: "info@bistro-mondo.com", to: ["harmke@example.com"], subject: "Cena 14 personas",
  text: "Hola Harmke — sí, tenemos sitio.", inReplyTo: "<abc@mail.example.com>", references: "<root@mail.example.com> <abc@mail.example.com>",
});
truthy("mime: Re: prefix added", /^Subject: Re: Cena 14 personas$/m.test(mime));
truthy("mime: In-Reply-To kept", /^In-Reply-To: <abc@mail\.example\.com>$/m.test(mime));
truthy("mime: References kept", /^References: <root@mail\.example\.com> <abc@mail\.example\.com>$/m.test(mime));
truthy("mime: utf-8 body base64", /Content-Transfer-Encoding: base64/.test(mime) && Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8") === "Hola Harmke — sí, tenemos sitio.");
const mime2 = buildReplyMime({ from: "a@b.c", to: ["x@y.z"], subject: "RE: already", text: "ok" });
truthy("mime: no double Re:", /^Subject: RE: already$/m.test(mime2));
eq("header word: ascii untouched", encodeHeaderWord("Cena 14 personas"), "Cena 14 personas");
truthy("header word: non-ascii encoded", encodeHeaderWord("Reservación").startsWith("=?UTF-8?B?"));
eq("base64url: no padding / url-safe", toBase64Url("??>"), Buffer.from("??>").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
eq("scopes: exactly the three gmail scopes + identity", GMAIL_SCOPES.filter((s) => s.includes("gmail.")).map((s) => s.split("/").pop()), ["gmail.readonly", "gmail.send", "gmail.modify"]);

// ---- E2 rules (no model call). A null verdict means "ask Haiku".
const base: ClassifyInput = { from_address: "x@example.com", from_name: null, subject: "", body: "", list_unsubscribe: null, precedence: null, auto_submitted: null, attachments: [], direction: "in" };
const rc = (p: Partial<ClassifyInput>) => ruleClassify({ ...base, ...p })?.category ?? null;
eq("rule: AEAT domain → fiscal_legal", rc({ from_address: "noreply@agenciatributaria.gob.es", subject: "Notificación" }), "fiscal_legal");
eq("rule: TGSS words → fiscal_legal", rc({ from_address: "gestor@asesoria.es", subject: "Requerimiento Seguridad Social — plazo 10 días" }), "fiscal_legal");
eq("rule: landlord words → fiscal_legal", rc({ from_address: "alberto@gmail.com", body: "Como arrendador le comunico el burofax enviado..." }), "fiscal_legal");
eq("rule: Fresto noreply → booking_change (not noise)", rc({ from_address: "noreply@fresto.io", subject: "Nueva reserva: 4 personas 21:00" }), "booking_change");
eq("rule: PDF + factura → supplier_doc", rc({ from_address: "ventas@servifruit.es", subject: "Factura FVA/7734", attachments: [{ filename: "FVA7734.pdf", mime: "application/pdf" }] }), "supplier_doc");
eq("rule: Holded notification → noise", rc({ from_address: "notifications@holded.com", subject: "Documento recibido" }), "newsletter_noise");
eq("rule: List-Unsubscribe → noise", rc({ from_address: "hello@mailchimp.com", subject: "October news", list_unsubscribe: "<mailto:u@x>" }), "newsletter_noise");
eq("rule: noreply sender, no booking words → noise", rc({ from_address: "no-reply@software.io", subject: "Your weekly digest" }), "newsletter_noise");
eq("rule: enquiry text → null (model decides + extracts)", rc({ from_address: "harmke@gmail.com", subject: "Cena para 14 personas en septiembre", body: "Hola, buscamos un chef privado para 14 personas..." }), null);
eq("rule: plain human mail → null", rc({ from_address: "pepe@gmail.com", subject: "Hola", body: "Una pregunta sobre el horario de domingo." }), null);
eq("rule: bare PDF, short body → supplier_doc (low confidence)", ruleClassify({ ...base, from_address: "a@b.com", body: "Adjunto.", attachments: [{ filename: "scan.pdf", mime: "application/pdf" }] })?.confidence ?? 0, 0.6);
eq("rule: enquiry with PDF menu attached is NOT a supplier doc", rc({ from_address: "eva@agency.com", subject: "Wedding dinner 40 pax", body: "Hi! We are planning a wedding dinner for 40 people, budget around 150 per person. Menu ideas attached.", attachments: [{ filename: "ideas.pdf", mime: "application/pdf" }] }), null);


// ---- E4 gate plumbing (pure). The SQL gate itself is probed live in a rolled-back
// transaction (ship note); here: the action the token is minted against hashes
// identically however the keys arrive, and the reply targets the last INBOUND.

const T_ENTITY = "387f1045-0000-0000-0000-000000000000", T_THREAD = "11111111-2222-3333-4444-555555555555";
const act = approveEmailAction(T_ENTITY, T_THREAD, "  Hola Harmke — sí, tenemos sitio.  ", "Harmke");
eq("approve_email: canonical shape", act, { type: "approve_email", entity_id: T_ENTITY, id: T_THREAD, text: "Hola Harmke — sí, tenemos sitio.", author: "Harmke" });
truthy("approve_email is in the outbound (token-required) class", CONFIRM_REQUIRED.has("approve_email"));
const shuffled: any = { author: "Harmke", text: "Hola Harmke — sí, tenemos sitio.", id: T_THREAD, entity_id: T_ENTITY, type: "approve_email", confirm_token: "x", turn_id: "y" };
eq("hash: key order + wire fields do not matter", actionHash(shuffled), actionHash(act as any));
eq("hash: equals sha256(canonical(hashable))) — what the edge function recomputes", actionHash(act as any), createHash("sha256").update(canonical(hashableAction(act as any))).digest("hex"));
truthy("hash: changing the text changes the hash", actionHash({ ...act, text: "otro texto" } as any) !== actionHash(act as any));
truthy("hash: changing the thread changes the hash", actionHash({ ...act, id: "99999999-2222-3333-4444-555555555555" } as any) !== actionHash(act as any));
eq("canonical: undefined dropped, nested sorted", canonical({ b: 1, a: { z: undefined, y: [2, { k: "v" }] } }), '{"a":{"y":[2,{"k":"v"}]},"b":1}');

eq("reply target: last inbound sender, threaded", replyTarget({ from_address: "first@x.com" }, { from_address: "Reply@X.com", message_id_header: "<m2@x>", references_header: "<m1@x>" }),
  { to: "reply@x.com", inReplyTo: "<m2@x>", references: "<m1@x> <m2@x>" });
eq("reply target: no inbound row → thread sender, no threading headers", replyTarget({ from_address: "first@x.com" }, null), { to: "first@x.com", inReplyTo: null, references: null });
eq("reply target: first reply in a thread → References = the one Message-ID", replyTarget({ from_address: null }, { from_address: "a@b.c", message_id_header: "<only@b.c>", references_header: null }), { to: "a@b.c", inReplyTo: "<only@b.c>", references: "<only@b.c>" });

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
