/**
 * Email channel (Comms, 2026-10-02) — pure-logic checks that run without a
 * Gmail token: header parsing, the reply MIME, the thread-safety of the
 * In-Reply-To / References headers. E2 adds the rule classifier here.
 *   sh scripts/test_email_channel.sh
 */
import { parseAddress, parseAddressList, buildReplyMime, toBase64Url, encodeHeaderWord, GMAIL_SCOPES } from "../lib/email/gmail";

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

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
