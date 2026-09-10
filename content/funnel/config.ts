// content/funnel/config.ts
//
// Sales funnel copy — filled by the comm/design agent.
//
// Overnight 2026-09-11 scaffolding. The OS lane built the leads schema,
// capture endpoint, admin board and a placeholder /leads/capture form so
// Boris can smoke-test end-to-end before the brand work lands. This file
// is the seam between the two lanes: when the comm agent finalises copy
// per venue, they replace the [[TO_FILL]] tokens below and the form
// component picks up the new strings on next deploy.
//
// Rules for the comm/design agent:
//   * Every string is optional-safe; consumers fall back to a plain-English
//     default when a value is still [[TO_FILL]] (see FUNNEL_COPY.resolve).
//   * Copy is keyed by entity slug ('bm', 'taller', 'studio' for the
//     holding/umbrella) — each venue gets its own tone.
//   * Never bake copy into the form component. The form reads from here.
//
// If a value is still [[TO_FILL]] at render time, the app shows a neutral
// placeholder in production but logs a warning in dev so the seams stay
// visible.

export type FunnelScope = "bm" | "taller" | "studio";

export type FunnelFormCopy = {
  heading: string;
  subhead: string;
  cta: string;
  success: string;
  field_labels: {
    name: string;
    email: string;
    phone: string;
    party_size: string;
    intent: string;
    requested_date: string;
    message: string;
  };
  intent_options: Array<{ value: string; label: string }>;
};

export type FunnelAutoReplyCopy = {
  subject: string;
  body: string;   // plain text; the send layer wraps with the venue's HTML shell
};

export type FunnelScopeCopy = {
  website_form: FunnelFormCopy;
  auto_reply: FunnelAutoReplyCopy;
};

const TO_FILL = "[[TO_FILL]]";

const DEFAULT_INTENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "booking",         label: "Table booking" },
  { value: "event",           label: "Event or group" },
  { value: "private-dining",  label: "Private dining" },
  { value: "catering",        label: "Catering" },
  { value: "general",         label: "Something else" },
];

// Default form copy — used for any string still marked [[TO_FILL]].
// Deliberately plain so a half-filled config never lies to a guest.
const DEFAULT_FORM: FunnelFormCopy = {
  heading: "Get in touch",
  subhead: "Tell us what you have in mind. We usually reply within a day.",
  cta: "Send",
  success: "Thank you. We have your note and will be in touch soon.",
  field_labels: {
    name: "Your name",
    email: "Email",
    phone: "Phone (optional)",
    party_size: "How many of you?",
    intent: "What is this about?",
    requested_date: "Which date, if any?",
    message: "Anything else we should know?",
  },
  intent_options: DEFAULT_INTENT_OPTIONS,
};

const DEFAULT_AUTO_REPLY: FunnelAutoReplyCopy = {
  subject: "We received your message",
  body:
    "Thank you for reaching out. We have your message and will get back to you shortly.\n\n" +
    "Best,\nThe team",
};

export const FUNNEL_COPY: Record<FunnelScope, FunnelScopeCopy> = {
  studio: {
    website_form: {
      heading: TO_FILL,
      subhead: TO_FILL,
      cta: TO_FILL,
      success: TO_FILL,
      field_labels: {
        name: TO_FILL,
        email: TO_FILL,
        phone: TO_FILL,
        party_size: TO_FILL,
        intent: TO_FILL,
        requested_date: TO_FILL,
        message: TO_FILL,
      },
      intent_options: DEFAULT_INTENT_OPTIONS,
    },
    auto_reply: { subject: TO_FILL, body: TO_FILL },
  },
  bm: {
    website_form: {
      heading: TO_FILL,
      subhead: TO_FILL,
      cta: TO_FILL,
      success: TO_FILL,
      field_labels: {
        name: TO_FILL,
        email: TO_FILL,
        phone: TO_FILL,
        party_size: TO_FILL,
        intent: TO_FILL,
        requested_date: TO_FILL,
        message: TO_FILL,
      },
      intent_options: DEFAULT_INTENT_OPTIONS,
    },
    auto_reply: { subject: TO_FILL, body: TO_FILL },
  },
  taller: {
    website_form: {
      heading: TO_FILL,
      subhead: TO_FILL,
      cta: TO_FILL,
      success: TO_FILL,
      field_labels: {
        name: TO_FILL,
        email: TO_FILL,
        phone: TO_FILL,
        party_size: TO_FILL,
        intent: TO_FILL,
        requested_date: TO_FILL,
        message: TO_FILL,
      },
      intent_options: DEFAULT_INTENT_OPTIONS,
    },
    auto_reply: { subject: TO_FILL, body: TO_FILL },
  },
};

function isPlaceholder(v: string | undefined | null): boolean {
  if (v == null) return true;
  return v === TO_FILL || v.trim() === "";
}

// Consumers call FUNNEL_COPY_RESOLVE(scope) to get a fully-populated copy
// object with any missing tokens filled from the neutral defaults. Keeps the
// form component honest: it can only render a real string, never [[TO_FILL]].
export function resolveFunnelCopy(scope: FunnelScope): FunnelScopeCopy {
  const raw = FUNNEL_COPY[scope];
  const wf = raw.website_form;
  const ar = raw.auto_reply;

  const website_form: FunnelFormCopy = {
    heading: isPlaceholder(wf.heading) ? DEFAULT_FORM.heading : wf.heading,
    subhead: isPlaceholder(wf.subhead) ? DEFAULT_FORM.subhead : wf.subhead,
    cta:     isPlaceholder(wf.cta)     ? DEFAULT_FORM.cta     : wf.cta,
    success: isPlaceholder(wf.success) ? DEFAULT_FORM.success : wf.success,
    field_labels: {
      name:            isPlaceholder(wf.field_labels.name)            ? DEFAULT_FORM.field_labels.name            : wf.field_labels.name,
      email:           isPlaceholder(wf.field_labels.email)           ? DEFAULT_FORM.field_labels.email           : wf.field_labels.email,
      phone:           isPlaceholder(wf.field_labels.phone)           ? DEFAULT_FORM.field_labels.phone           : wf.field_labels.phone,
      party_size:      isPlaceholder(wf.field_labels.party_size)      ? DEFAULT_FORM.field_labels.party_size      : wf.field_labels.party_size,
      intent:          isPlaceholder(wf.field_labels.intent)          ? DEFAULT_FORM.field_labels.intent          : wf.field_labels.intent,
      requested_date:  isPlaceholder(wf.field_labels.requested_date)  ? DEFAULT_FORM.field_labels.requested_date  : wf.field_labels.requested_date,
      message:         isPlaceholder(wf.field_labels.message)         ? DEFAULT_FORM.field_labels.message         : wf.field_labels.message,
    },
    intent_options: (wf.intent_options && wf.intent_options.length) ? wf.intent_options : DEFAULT_INTENT_OPTIONS,
  };

  const auto_reply: FunnelAutoReplyCopy = {
    subject: isPlaceholder(ar.subject) ? DEFAULT_AUTO_REPLY.subject : ar.subject,
    body:    isPlaceholder(ar.body)    ? DEFAULT_AUTO_REPLY.body    : ar.body,
  };

  return { website_form, auto_reply };
}

// True when the scope is still awaiting brand copy — used by /studio/growth
// to badge the funnel as "copy pending" until the comm agent lands strings.
export function isScopeAwaitingCopy(scope: FunnelScope): boolean {
  const raw = FUNNEL_COPY[scope];
  const strings = [
    raw.website_form.heading,
    raw.website_form.subhead,
    raw.website_form.cta,
    raw.website_form.success,
    raw.auto_reply.subject,
    raw.auto_reply.body,
  ];
  return strings.some(isPlaceholder);
}
