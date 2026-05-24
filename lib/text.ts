// Strip any emoji / pictographic glyphs from displayed text. No icons, no emoji — house rule.
export const noEmoji = (s: string | null | undefined): string =>
  (s || "")
    .replace(/[\p{Extended_Pictographic}‍️⃣]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
