import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AuthCapabilities, VirituraUser } from "./api";
import type { VirituraAccountState, GitHubAccountState } from "./AccountContext";
import { AccountDetails } from "./AccountDetails";

const authMocks = vi.hoisted(() => ({
  capabilities: {
    gitHubLoginEnabled: true,
    googleLoginEnabled: false,
    emailRegistrationMode: "Open",
  } as AuthCapabilities,
}));

vi.mock("./useAuthCapabilities", () => ({
  useAuthCapabilities: () => authMocks.capabilities,
}));

vi.mock("./TwoFactorSection", () => ({
  TwoFactorRow: () => <div>Two-factor authentication</div>,
}));

const USER: VirituraUser = {
  id: "user-1",
  email: "composer@viritura.test",
  displayName: "Composer",
  avatarUrl: null,
  hasPassword: true,
  externalLogins: [],
};

const ACCOUNT: VirituraAccountState = {
  status: "ready",
  user: USER,
  error: null,
  refresh: vi.fn(async () => undefined),
  signIn: vi.fn(),
  signInTwoFactor: vi.fn(),
  signInRecovery: vi.fn(),
  register: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signOutEverywhere: vi.fn(async () => undefined),
};

const GITHUB: GitHubAccountState = {
  status: "ready",
  app: { configured: true, appSlug: "viritura", clientId: "client-id", installUrl: null },
  session: { connected: false, viewer: null, accessTokenExpiresAtUtc: null, installation: null },
  error: null,
  refresh: vi.fn(async () => undefined),
  signIn: vi.fn(),
  unlink: vi.fn(async () => undefined),
  createRepository: vi.fn(),
};

afterEach(() => {
  cleanup();
  authMocks.capabilities = {
    gitHubLoginEnabled: true,
    googleLoginEnabled: false,
    emailRegistrationMode: "Open",
  };
});

describe("AccountDetails", () => {
  it("hides Google when the provider is not configured", () => {
    render(<AccountDetails account={ACCOUNT} github={GITHUB} user={USER} />);

    expect(screen.queryByText("Google")).toBeNull();
  });

  it("omits the connected-accounts section when no provider is available", () => {
    authMocks.capabilities = {
      ...authMocks.capabilities,
      gitHubLoginEnabled: false,
      googleLoginEnabled: false,
    };

    render(<AccountDetails account={ACCOUNT} github={GITHUB} user={USER} />);

    expect(screen.queryByRole("region", { name: "Connected accounts" })).toBeNull();
  });

  it("shows Google when the capabilities endpoint enables it", () => {
    authMocks.capabilities = { ...authMocks.capabilities, googleLoginEnabled: true };

    render(<AccountDetails account={ACCOUNT} github={GITHUB} user={USER} />);

    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(2);
  });

  it("keeps a linked Google identity manageable when new Google logins are disabled", () => {
    const linkedUser: VirituraUser = {
      ...USER,
      externalLogins: [{ provider: "Google", providerKey: "google-1", displayName: "Composer" }],
    };

    render(<AccountDetails account={ACCOUNT} github={GITHUB} user={linkedUser} />);

    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage…" })).toBeTruthy();
  });

  it("uses values and actions instead of redundant status badges", () => {
    render(<AccountDetails account={ACCOUNT} github={GITHUB} user={USER} />);

    expect(screen.queryByText("Set")).toBeNull();
    expect(screen.queryByText("Enabled")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.queryByText("Not configured")).toBeNull();
    expect(screen.getByText("Danger zone")).toBeTruthy();
    expect(screen.getAllByText(USER.email)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Manage password/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete account…" })).toBeTruthy();
  });
});
