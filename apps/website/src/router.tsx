/* eslint-disable react-refresh/only-export-components -- client hydration and static generation share this route tree's typed router factory */
/**
 * TanStack Router setup (code-based, no codegen).
 *
 * We use a root layout route that mounts <SiteNav> and <SiteFooter> once, with
 * child routes rendering into <Outlet />. The home route keeps the marketing
 * sections; /mnx/mxl-converter lazy-loads the converter; /signup, /signup/check-email,
 * and /auth/verify host the email sign-up + verification flow.
 */

import { lazy, Suspense } from "react";
import {
  ClientOnly,
  Outlet,
  Scripts,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
  type RouterHistory,
} from "@tanstack/react-router";
import { HeroSection } from "./HeroSection";
import {
  CollaborationValueStrip,
  CollaborationSection,
  FinalCtaSection,
  InputSection,
  OpenApproachSection,
  PartsSection,
  SiteFooter,
  SiteNav,
  WorkflowSection,
} from "./siteSections";
import { editorUrl, type SiteLinks } from "./siteLinks";
import { readSensitiveLinkParam } from "./routes/auth/sensitiveLink";
import { ConverterGuide } from "./routes/mnx-converter/ConverterGuide";
import { ClientMetadata } from "./seo";

const links: SiteLinks = {
  app: editorUrl,
  docs: "/docs",
  github: "https://github.com/Viritura/Viritura",
};

const MusicXmlConverterPage = lazy(() =>
  import("./routes/mnx-converter/MusicXmlConverterPage").then((module) => ({
    default: module.MusicXmlConverterPage,
  })),
);

const MnxHubPage = lazy(() => import("./routes/mnx").then((module) => ({ default: module.MnxHubPage })));

const MnxPlaygroundPage = lazy(() =>
  import("./routes/mnx-playground").then((module) => ({ default: module.MnxPlaygroundPage })),
);

const DocsPage = lazy(() => import("./routes/docs/DocsPage").then((module) => ({ default: module.DocsPage })));
const DOCS_DEFAULT_SLUG = "getting-started";

const SignUpPage = lazy(() => import("./routes/auth/SignUpPage").then((module) => ({ default: module.SignUpPage })));

const CheckEmailPage = lazy(() =>
  import("./routes/auth/CheckEmailPage").then((module) => ({ default: module.CheckEmailPage })),
);

const VerifyEmailPage = lazy(() =>
  import("./routes/auth/VerifyEmailPage").then((module) => ({ default: module.VerifyEmailPage })),
);

const ForgotPasswordPage = lazy(() =>
  import("./routes/auth/ForgotPasswordPage").then((module) => ({ default: module.ForgotPasswordPage })),
);

const ResetPasswordPage = lazy(() =>
  import("./routes/auth/ResetPasswordPage").then((module) => ({ default: module.ResetPasswordPage })),
);

const TwoFactorRecoveryPage = lazy(() =>
  import("./routes/auth/TwoFactorRecoveryPage").then((module) => ({ default: module.TwoFactorRecoveryPage })),
);

const ConfirmEmailChangePage = lazy(() =>
  import("./routes/auth/ConfirmEmailChangePage").then((module) => ({ default: module.ConfirmEmailChangePage })),
);

function StaticToolIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <section className="route-loading">
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}

function StaticAccountIntro({ title }: { title: string }) {
  return (
    <section className="route-loading">
      <h1>{title}</h1>
    </section>
  );
}

const rootRoute = createRootRoute({
  notFoundComponent: function NotFoundRoute() {
    return (
      <main id="top" className="route-main">
        <div className="route-loading">
          <h1>Page not found</h1>
          <p>The page you requested does not exist.</p>
          <a href="/">Return to Viritura</a>
        </div>
      </main>
    );
  },
  component: function RootLayout() {
    const pathname = useRouterState({ select: (state) => state.location.pathname.replace(/\/$/, "") || "/" });
    const isPlayground = pathname === "/mnx/playground";
    return (
      <div className={`site-shell${isPlayground ? " site-shell--workspace" : ""}`}>
        <ClientMetadata />
        <SiteNav links={links} />
        <Outlet />
        <SiteFooter links={links} />
        <Scripts />
      </div>
    );
  },
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function HomeRoute() {
    return (
      <main id="top" className="marketing-home">
        <HeroSection links={links} />
        <CollaborationValueStrip />
        <WorkflowSection />
        <InputSection links={links} />
        <PartsSection links={links} />
        <CollaborationSection />
        <OpenApproachSection />
        <FinalCtaSection links={links} />
      </main>
    );
  },
});

const converterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mnx/mxl-converter",
  component: function ConverterRoute() {
    return (
      <main id="top" className="route-main converter-route">
        <ClientOnly
          fallback={
            <StaticToolIntro
              eyebrow="MusicXML to MNX"
              title="Convert MusicXML to MNX in your browser"
              description="Create an open MNX document from MusicXML, inspect the conversion, and download the result."
            />
          }
        >
          <Suspense fallback={<div className="route-loading">Loading converter...</div>}>
            <MusicXmlConverterPage />
          </Suspense>
        </ClientOnly>
        <ConverterGuide />
      </main>
    );
  },
});

const mnxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mnx",
  component: function MnxRoute() {
    return (
      <main id="top" className="route-main">
        <Suspense fallback={<div className="route-loading">Loading MNX hub...</div>}>
          <MnxHubPage appUrl={links.app} />
        </Suspense>
      </main>
    );
  },
});

const mnxPlaygroundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mnx/playground",
  component: function MnxPlaygroundRoute() {
    return (
      <main id="top" className="route-main mnx-playground-route">
        <ClientOnly
          fallback={
            <StaticToolIntro
              eyebrow="MNX Playground"
              title="Edit MNX and inspect the engraving"
              description="Edit the MNX documentation examples and inspect their engraved output in Viritura's browser-based playground."
            />
          }
        >
          <Suspense fallback={<div className="route-loading">Loading MNX playground...</div>}>
            <MnxPlaygroundPage />
          </Suspense>
        </ClientOnly>
      </main>
    );
  },
});

const docsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/docs",
  component: function DocsIndexRoute() {
    return (
      <main id="top" className="route-main docs-route">
        <Suspense fallback={<div className="route-loading">Loading docs…</div>}>
          <DocsPage slug={DOCS_DEFAULT_SLUG} />
        </Suspense>
      </main>
    );
  },
});

const docsPageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/docs/$slug",
  component: function DocsPageRoute() {
    const { slug } = docsPageRoute.useParams();
    return (
      <main id="top" className="route-main docs-route">
        <Suspense fallback={<div className="route-loading">Loading docs…</div>}>
          <DocsPage slug={slug} />
        </Suspense>
      </main>
    );
  },
});

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  component: function SignUpRoute() {
    return (
      <main id="top" className="route-main">
        <ClientOnly fallback={<StaticAccountIntro title="Create an account" />}>
          <Suspense fallback={<div className="route-loading">Loading…</div>}>
            <SignUpPage appUrl={links.app} />
          </Suspense>
        </ClientOnly>
      </main>
    );
  },
});

const checkEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup/check-email",
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email : "",
  }),
  component: function CheckEmailRoute() {
    const { email } = checkEmailRoute.useSearch();
    return (
      <main id="top" className="route-main">
        <ClientOnly fallback={<StaticAccountIntro title="Check your email" />}>
          <Suspense fallback={<div className="route-loading">Loading…</div>}>
            <CheckEmailPage email={email} />
          </Suspense>
        </ClientOnly>
      </main>
    );
  },
});

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/verify",
  validateSearch: (search: Record<string, unknown>) => ({
    uid: readSensitiveLinkParam(search, "uid"),
    token: readSensitiveLinkParam(search, "token"),
  }),
  component: function VerifyEmailRoute() {
    const { uid, token } = verifyEmailRoute.useSearch();
    return (
      <main id="top" className="route-main">
        <ClientOnly fallback={<StaticAccountIntro title="Verify your email" />}>
          <Suspense fallback={<div className="route-loading">Loading…</div>}>
            <VerifyEmailPage uid={uid} token={token} appUrl={links.app} />
          </Suspense>
        </ClientOnly>
      </main>
    );
  },
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/forgot-password",
  component: function ForgotPasswordRoute() {
    return (
      <main id="top" className="route-main">
        <ClientOnly fallback={<StaticAccountIntro title="Reset your password" />}>
          <Suspense fallback={<div className="route-loading">Loading…</div>}>
            <ForgotPasswordPage />
          </Suspense>
        </ClientOnly>
      </main>
    );
  },
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/reset-password",
  validateSearch: (search: Record<string, unknown>) => ({
    uid: readSensitiveLinkParam(search, "uid"),
    token: readSensitiveLinkParam(search, "token"),
  }),
  component: function ResetPasswordRoute() {
    const { uid, token } = resetPasswordRoute.useSearch();
    return (
      <main id="top" className="route-main">
        <ClientOnly fallback={<StaticAccountIntro title="Choose a new password" />}>
          <Suspense fallback={<div className="route-loading">Loading…</div>}>
            <ResetPasswordPage uid={uid} token={token} appUrl={links.app} />
          </Suspense>
        </ClientOnly>
      </main>
    );
  },
});

const twoFactorRecoveryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/2fa-recovery",
  validateSearch: (search: Record<string, unknown>) => ({
    uid: readSensitiveLinkParam(search, "uid"),
    token: readSensitiveLinkParam(search, "token"),
  }),
  component: function TwoFactorRecoveryRoute() {
    const { uid, token } = twoFactorRecoveryRoute.useSearch();
    return (
      <main id="top" className="route-main">
        <ClientOnly fallback={<StaticAccountIntro title="Recover two-factor authentication" />}>
          <Suspense fallback={<div className="route-loading">Loading…</div>}>
            <TwoFactorRecoveryPage uid={uid} token={token} appUrl={links.app} />
          </Suspense>
        </ClientOnly>
      </main>
    );
  },
});

const confirmEmailChangeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/confirm-email-change",
  validateSearch: (search: Record<string, unknown>) => ({
    uid: readSensitiveLinkParam(search, "uid"),
    email: readSensitiveLinkParam(search, "email"),
    token: readSensitiveLinkParam(search, "token"),
  }),
  component: function ConfirmEmailChangeRoute() {
    const { uid, email, token } = confirmEmailChangeRoute.useSearch();
    return (
      <main id="top" className="route-main">
        <ClientOnly fallback={<StaticAccountIntro title="Confirm your email change" />}>
          <Suspense fallback={<div className="route-loading">Loading…</div>}>
            <ConfirmEmailChangePage uid={uid} newEmail={email} token={token} appUrl={links.app} />
          </Suspense>
        </ClientOnly>
      </main>
    );
  },
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  mnxRoute,
  mnxPlaygroundRoute,
  converterRoute,
  docsIndexRoute,
  docsPageRoute,
  signUpRoute,
  checkEmailRoute,
  verifyEmailRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  twoFactorRecoveryRoute,
  confirmEmailChangeRoute,
]);

export function createWebsiteRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history });
}

type WebsiteRouter = ReturnType<typeof createWebsiteRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: WebsiteRouter;
  }
}
