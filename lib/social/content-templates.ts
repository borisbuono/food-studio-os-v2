// Social content templates — the prompt library the AI generator uses.
//
// Every entry pins the intent (what this post is trying to do), the shape
// (rough length + rhythm), and the render(ctx) → user-prompt builder that
// gets fed into the assistant orchestrator alongside the entity's voice
// profile from assistant_config.
//
// The generator UI picks ONE template + entity + optional context ref
// (menu_item / commercial / event / etc.) and the API turns that into three
// draft variants the user picks between. We keep the templates verbose on
// purpose — the whole point of moving social in-house is that Boris shouldn't
// have to reinvent the brief every time.
//
// This file is data + tiny helpers. It never calls the model directly.

export type ContentTemplateType =
  | "dish_spotlight"
  | "wine_feature"
  | "team_intro"
  | "behind_the_scenes"
  | "seasonal"
  | "event_promo"
  | "guest_repost";

export type ContextRef = {
  kind?: "menu_item" | "commercial" | "event" | "team_member" | "guest_review" | "free_text" | null;
  label?: string;                 // e.g. dish name, wine name, event title
  detail?: string;                // free-text context Boris paste
  price_eur?: number | null;
  when?: string | null;           // ISO for events / seasons
  extras?: Record<string, unknown>;
};

export type ContentTemplate = {
  type: ContentTemplateType;
  label: string;
  blurb: string;
  category: "menu" | "story" | "team" | "behind_scenes" | "promo";
  // How much room the model should take.
  target_length: { min: number; max: number; unit: "chars" };
  // What the generator asks the model for — plain-English brief.
  render: (ctx: ContextRef, entityBrand: string) => string;
};

const DEFAULT_LEN = { min: 380, max: 640, unit: "chars" as const };
const SHORT_LEN   = { min: 240, max: 420, unit: "chars" as const };

function line(label: string, value?: string | number | null): string {
  if (value === undefined || value === null || value === "") return "";
  return `- ${label}: ${value}`;
}

export const CONTENT_TEMPLATES: Record<ContentTemplateType, ContentTemplate> = {
  dish_spotlight: {
    type: "dish_spotlight",
    label: "Dish spotlight",
    blurb: "Feature one plate — story, technique, why it's on the menu.",
    category: "menu",
    target_length: DEFAULT_LEN,
    render: (ctx, entityBrand) => [
      `Write a social post that spotlights a dish at ${entityBrand}.`,
      "Lead with the sensory hook (taste, texture, smell), then the origin",
      "or technique, then a soft invitation (no pushy CTA).",
      "",
      "Context:",
      line("dish name", ctx.label),
      line("price", ctx.price_eur ? `€${ctx.price_eur}` : null),
      line("kitchen note", ctx.detail),
      "",
      "Constraints:",
      "- Editorial tone, no exclamation marks, no 'delicious' cliché.",
      "- End with a single hashtag block (3-5 relevant hashtags).",
    ].filter(Boolean).join("\n"),
  },
  wine_feature: {
    type: "wine_feature",
    label: "Wine feature",
    blurb: "Bottle of the week — grower, region, pairing.",
    category: "menu",
    target_length: DEFAULT_LEN,
    render: (ctx, entityBrand) => [
      `Write a social post for ${entityBrand} featuring a wine we love this week.`,
      "Anchor it in place (region, grower, farming), suggest one pairing on the",
      "current menu if we have it, keep it curious rather than salesy.",
      "",
      "Context:",
      line("wine", ctx.label),
      line("notes", ctx.detail),
      line("price by the glass", ctx.price_eur ? `€${ctx.price_eur}` : null),
      "",
      "Constraints:",
      "- Serifed voice. Avoid 'must-try', 'delicious', 'perfect'.",
      "- End with 2-4 hashtags including one region tag.",
    ].filter(Boolean).join("\n"),
  },
  team_intro: {
    type: "team_intro",
    label: "Team member intro",
    blurb: "Introduce someone on the team — a face, a role, a personal note.",
    category: "team",
    target_length: DEFAULT_LEN,
    render: (ctx, entityBrand) => [
      `Introduce a team member at ${entityBrand} in a social post.`,
      "First name, role, one thing they do that shapes the guest experience,",
      "one human detail. Warm, not corporate.",
      "",
      "Context:",
      line("person", ctx.label),
      line("role + colour", ctx.detail),
      "",
      "Constraints:",
      "- First-person plural ('we') where it fits, otherwise third-person.",
      "- No 'meet the team' opener.",
      "- End with a small hashtag block (2-4 tags).",
    ].filter(Boolean).join("\n"),
  },
  behind_the_scenes: {
    type: "behind_the_scenes",
    label: "Behind the scenes",
    blurb: "Prep, a market run, a slow service, a candid moment.",
    category: "behind_scenes",
    target_length: SHORT_LEN,
    render: (ctx, entityBrand) => [
      `Write a short behind-the-scenes moment at ${entityBrand}.`,
      "Small window into how the kitchen or floor actually runs. Concrete,",
      "specific, unpolished — the opposite of a brochure.",
      "",
      "Context:",
      line("moment", ctx.label),
      line("detail", ctx.detail),
      "",
      "Constraints:",
      "- No 'take a peek' opener.",
      "- 2-3 short paragraphs max, one hashtag at the end.",
    ].filter(Boolean).join("\n"),
  },
  seasonal: {
    type: "seasonal",
    label: "Seasonal moment",
    blurb: "Weather, harvest, festival, calendar shift.",
    category: "story",
    target_length: DEFAULT_LEN,
    render: (ctx, entityBrand) => [
      `Write a seasonal social post for ${entityBrand}.`,
      "Root it in something happening right now on the island or the calendar,",
      "then thread it to what's on our tables this week.",
      "",
      "Context:",
      line("season / moment", ctx.label),
      line("what's on the plate", ctx.detail),
      line("when", ctx.when),
      "",
      "Constraints:",
      "- Ibiza-specific if we can — market names, harvest crops, breeze.",
      "- 3-5 hashtags including one seasonal tag.",
    ].filter(Boolean).join("\n"),
  },
  event_promo: {
    type: "event_promo",
    label: "Event promo",
    blurb: "Announce a dinner, tasting, session — with the practical detail.",
    category: "promo",
    target_length: DEFAULT_LEN,
    render: (ctx, entityBrand) => [
      `Announce an event at ${entityBrand} in a social post.`,
      "Lead with the shape of the evening (what guests will actually",
      "experience), then the practical: date, time, price, how to book.",
      "",
      "Context:",
      line("event", ctx.label),
      line("what happens", ctx.detail),
      line("price", ctx.price_eur ? `€${ctx.price_eur}` : null),
      line("when", ctx.when),
      "",
      "Constraints:",
      "- Include the date and booking method as a distinct last paragraph.",
      "- 3-5 hashtags. No 'don't miss out'.",
    ].filter(Boolean).join("\n"),
  },
  guest_repost: {
    type: "guest_repost",
    label: "Guest feedback repost",
    blurb: "Repost a review or a note — with a warm reply, not a boast.",
    category: "story",
    target_length: SHORT_LEN,
    render: (ctx, entityBrand) => [
      `A guest left a lovely note at ${entityBrand}. Draft a social post that`,
      "quotes them briefly (fair use — one sentence) and answers back warmly.",
      "No trophy-collecting. The point is the exchange.",
      "",
      "Context:",
      line("guest note", ctx.detail),
      line("who / handle", ctx.label),
      "",
      "Constraints:",
      "- Quote in italics-safe form (use straight quotes).",
      "- 2 short paragraphs + 1-2 hashtags.",
    ].filter(Boolean).join("\n"),
  },
};

export const TEMPLATE_LIST: ContentTemplate[] = Object.values(CONTENT_TEMPLATES);

// Category we store on social_content_ideas when the AI generator saves.
export function templateCategory(t: ContentTemplateType): "menu" | "story" | "team" | "behind_scenes" | "promo" {
  return CONTENT_TEMPLATES[t].category;
}
