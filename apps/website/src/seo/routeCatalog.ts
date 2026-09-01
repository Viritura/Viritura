export const SITE_ORIGIN = "https://viritura.com";

export interface SeoRoute {
  path: string;
  renderPath?: string;
  title: string;
  description: string;
  canonicalPath: string;
  indexable: boolean;
  outputPath?: string;
}

const publicRoutes: readonly SeoRoute[] = [
  {
    path: "/",
    title: "Viritura: Collaborative Music Notation Software",
    description:
      "Write, revise, review, and publish in one connected music notation workspace built around an open score format.",
    canonicalPath: "/",
    indexable: true,
  },
  {
    path: "/mnx",
    title: "MNX Music Notation Format: Guide, Examples and Tools | Viritura",
    description:
      "Learn what the MNX music notation format is, how MNX differs from MusicXML, and how to inspect and edit MNX in your browser.",
    canonicalPath: "/mnx",
    indexable: true,
  },
  {
    path: "/mnx/playground",
    title: "Online MNX Editor and Engraving Playground | Viritura",
    description:
      "Edit 52 MNX documentation examples in the browser and inspect live output from Viritura's Rust and WebAssembly engraving engine.",
    canonicalPath: "/mnx/playground",
    indexable: true,
  },
  {
    path: "/mnx/mxl-converter",
    title: "MusicXML to MNX Converter: Convert MXL Online | Viritura",
    description:
      "Convert MusicXML and compressed MXL files to MNX in your browser. Preview the score, review conversion details, and download the MNX document.",
    canonicalPath: "/mnx/mxl-converter",
    indexable: true,
  },
  {
    path: "/docs",
    title: "Getting Started | Viritura Documentation",
    description:
      "Set up Viritura and learn the essential workflows for creating, editing, reviewing, and sharing music.",
    canonicalPath: "/docs/getting-started",
    indexable: true,
  },
  {
    path: "/docs/getting-started",
    title: "Getting Started | Viritura Documentation",
    description:
      "Set up Viritura and learn the essential workflows for creating, editing, reviewing, and sharing music.",
    canonicalPath: "/docs/getting-started",
    indexable: true,
  },
  {
    path: "/docs/instruments-and-scores",
    title: "Scores, Parts and Layouts | Viritura Documentation",
    description:
      "Learn how MNX source parts, score definitions, layouts, full scores, and instrumental parts work in Viritura.",
    canonicalPath: "/docs/instruments-and-scores",
    indexable: true,
  },
  {
    path: "/docs/percussion-maps",
    title: "Percussion Maps | Viritura Documentation",
    description: "Configure percussion maps and notation for unpitched instruments in Viritura documents.",
    canonicalPath: "/docs/percussion-maps",
    indexable: true,
  },
  {
    path: "/docs/note-entry",
    title: "Note Entry | Viritura Documentation",
    description: "Enter notes, rests, chords, tuplets, and other musical events efficiently in Viritura.",
    canonicalPath: "/docs/note-entry",
    indexable: true,
  },
  {
    path: "/docs/notation-and-editing",
    title: "Notation and Editing | Viritura Documentation",
    description: "Edit pitches, rhythms, articulations, directions, and other notation in a Viritura document.",
    canonicalPath: "/docs/notation-and-editing",
    indexable: true,
  },
  {
    path: "/docs/engraving-and-layout",
    title: "Engraving and Layout | Viritura Documentation",
    description: "Control engraving, spacing, page layout, condensing, and score appearance in Viritura.",
    canonicalPath: "/docs/engraving-and-layout",
    indexable: true,
  },
  {
    path: "/docs/playback-and-piano-roll",
    title: "Playback, Mixer and Piano Roll | Viritura Documentation",
    description: "Use score playback, mixer controls, sound profiles, and the piano roll in Viritura.",
    canonicalPath: "/docs/playback-and-piano-roll",
    indexable: true,
  },
  {
    path: "/docs/scoring-to-picture",
    title: "Scoring to Picture | Viritura Documentation",
    description: "Synchronize a Viritura document with video, timecode, markers, and picture-in-picture workflows.",
    canonicalPath: "/docs/scoring-to-picture",
    indexable: true,
  },
  {
    path: "/docs/collaboration",
    title: "Collaboration | Viritura Documentation",
    description: "Collaborate on a Viritura document with shared editing, presence, awareness, and review workflows.",
    canonicalPath: "/docs/collaboration",
    indexable: true,
  },
  {
    path: "/docs/mcp",
    title: "MCP Integration | Viritura Documentation",
    description: "Connect MCP-compatible tools to inspect music, analyze a document, and propose reviewable changes.",
    canonicalPath: "/docs/mcp",
    indexable: true,
  },
  {
    path: "/docs/viewing-and-review",
    title: "Viewing and Review | Viritura Documentation",
    description:
      "View, compare, annotate, and review music in Viritura while keeping feedback attached to the document.",
    canonicalPath: "/docs/viewing-and-review",
    indexable: true,
  },
  {
    path: "/docs/publishing-and-export",
    title: "Publishing and Export | Viritura Documentation",
    description: "Prepare scores and instrumental parts for publishing, printing, sharing, and export from Viritura.",
    canonicalPath: "/docs/publishing-and-export",
    indexable: true,
  },
  {
    path: "/docs/settings-and-import",
    title: "Settings and Import | Viritura Documentation",
    description: "Configure Viritura and import existing notation documents into an open music workflow.",
    canonicalPath: "/docs/settings-and-import",
    indexable: true,
  },
  {
    path: "/docs/keyboard-shortcuts",
    title: "Keyboard and Mouse Shortcuts | Viritura Documentation",
    description: "Reference Viritura's keyboard shortcuts, mouse gestures, and efficient notation editing controls.",
    canonicalPath: "/docs/keyboard-shortcuts",
    indexable: true,
  },
];

const accountRoutes: readonly SeoRoute[] = [
  ["/signup", "Create an Account | Viritura", undefined],
  ["/signup/check-email", "Check Your Email | Viritura", "/signup/check-email?email=prerender%40viritura.com"],
  ["/auth/verify", "Verify Your Email | Viritura", "/auth/verify?uid=prerender&token=prerender"],
  ["/auth/forgot-password", "Reset Your Password | Viritura", undefined],
  ["/auth/reset-password", "Choose a New Password | Viritura", "/auth/reset-password?uid=prerender&token=prerender"],
  [
    "/auth/2fa-recovery",
    "Recover Two-Factor Authentication | Viritura",
    "/auth/2fa-recovery?uid=prerender&token=prerender",
  ],
  [
    "/auth/confirm-email-change",
    "Confirm Your Email Change | Viritura",
    "/auth/confirm-email-change?uid=prerender&email=prerender%40viritura.com&token=prerender",
  ],
].map(([path, title, renderPath]) => ({
  path: path!,
  renderPath,
  title: title!,
  description: "Secure Viritura account workflow.",
  canonicalPath: path!,
  indexable: false,
}));

const notFoundRoute: SeoRoute = {
  path: "/404",
  title: "Page Not Found | Viritura",
  description: "The requested Viritura page could not be found.",
  canonicalPath: "/404",
  indexable: false,
  outputPath: "404.html",
};

export const staticRoutes: readonly SeoRoute[] = [...publicRoutes, ...accountRoutes, notFoundRoute];
export const sitemapRoutes: readonly SeoRoute[] = publicRoutes.filter(
  (route) => route.indexable && route.path !== "/docs",
);

export function findSeoRoute(pathname: string): SeoRoute {
  const normalizedPath = pathname.replace(/\/$/, "") || "/";
  return staticRoutes.find((route) => route.path === normalizedPath) ?? notFoundRoute;
}

export function canonicalUrl(route: SeoRoute): string {
  return new URL(route.canonicalPath, SITE_ORIGIN).href;
}
