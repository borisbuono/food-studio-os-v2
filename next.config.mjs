import {
  contentSecurityPolicy,
  GUEST_FRAMEABLE_PREFIXES as GUEST,
} from "./lib/security/csp.mjs";

// Security headers — S5(a), 2026-10-03. The policy itself and the reasoning
// live in lib/security/csp.mjs; this file only decides which paths get which.
//
// Exactly ONE Content-Security-Policy per response: the two rules below have
// non-overlapping sources, so no path ever receives two. scripts/test_csp_headers.sh
// asserts that against a real build.

const GUEST_GROUP = GUEST.join("|");

const commonHeaders = [
  { key: "Reporting-Endpoints", value: 'csp="/api/csp-report"' },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // One year, subdomains included. Not `preload` — that is a one-way door and
  // needs Boris's tick, not a builder's.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // camera + microphone stay on: the capture station photographs albaranes and
  // the Chef drawer takes voice. Everything else off.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), bluetooth=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

function cspHeaders({ frameAncestorsNone }) {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy({ frameAncestorsNone }) },
    // The same policy with 'unsafe-inline' removed, reported and not enforced.
    // Its reports are the evidence for the nonce pass. Nothing breaks from this.
    {
      key: "Content-Security-Policy-Report-Only",
      value: contentSecurityPolicy({ frameAncestorsNone, strictScripts: true }),
    },
    ...commonHeaders,
  ];
}

const nextConfig = {
  async headers() {
    return [
      // Guest-facing, frameable.
      {
        source: `/:guest(${GUEST_GROUP})/:path*`,
        headers: cspHeaders({ frameAncestorsNone: false }),
      },
      {
        source: `/:guest(${GUEST_GROUP})`,
        headers: cspHeaders({ frameAncestorsNone: false }),
      },
      // Everything else — the authenticated OS, /welcome and /login included.
      {
        source: `/((?!${GUEST.map((p) => `${p}/|${p}$`).join("|")}).*)`,
        headers: cspHeaders({ frameAncestorsNone: true }),
      },
    ];
  },
};

export default nextConfig;
