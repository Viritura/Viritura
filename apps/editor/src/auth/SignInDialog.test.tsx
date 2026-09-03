import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthApiError, type AuthCapabilities, type VirituraUser } from "./api";
import type { VirituraAccountState } from "./AccountContext";
import { SignInDialog } from "./SignInDialog";

const authMocks = vi.hoisted(() => ({
  capabilities: {
    gitHubLoginEnabled: false,
    googleLoginEnabled: false,
    emailRegistrationMode: "Open",
  } as AuthCapabilities,
}));

vi.mock("./useAuthCapabilities", () => ({
  useAuthCapabilities: () => authMocks.capabilities,
}));

afterEach(cleanup);

const USER: VirituraUser = {
  id: "test-user",
  email: "test@example.com",
  displayName: "Test User",
  avatarUrl: null,
  hasPassword: true,
  externalLogins: [],
};

function makeAccount(signIn: VirituraAccountState["signIn"]): VirituraAccountState {
  return {
    status: "ready",
    user: null,
    error: null,
    refresh: vi.fn(async () => undefined),
    signIn,
    signInTwoFactor: vi.fn(async () => USER),
    signInRecovery: vi.fn(async () => USER),
    register: vi.fn(async () => USER),
    signOut: vi.fn(async () => undefined),
    signOutEverywhere: vi.fn(async () => undefined),
  };
}

describe("SignInDialog", () => {
  afterEach(() => {
    authMocks.capabilities = { ...authMocks.capabilities, gitHubLoginEnabled: false };
    window.history.pushState(null, "", "/");
  });

  it("uses the official GitHub mark when GitHub login is configured", () => {
    authMocks.capabilities = { ...authMocks.capabilities, gitHubLoginEnabled: true };
    render(<SignInDialog open account={makeAccount(vi.fn())} onClose={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Continue with GitHub" });
    expect(button.querySelector('svg[viewBox="0 0 98 96"]')).toBeTruthy();
  });

  it("hides unavailable providers and requires both credentials", async () => {
    const signIn = vi.fn(async () => ({ status: "signedIn" as const, user: USER }));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SignInDialog open account={makeAccount(signIn)} onClose={onClose} />);

    expect(screen.queryByRole("button", { name: "Continue with GitHub" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "letmein123");
    expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "letmein123",
      rememberMe: true,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows compact recovery after failure and clears stale errors when edited", async () => {
    const signIn = vi.fn(async () => {
      throw new AuthApiError("Invalid email or password.", 401);
    });
    const user = userEvent.setup();
    render(<SignInDialog open account={makeAccount(signIn)} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Invalid email or password.");
    expect(screen.getByText("Need to verify your email?")).toBeTruthy();

    await user.type(screen.getByLabelText("Password"), "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens directly to the OAuth two-factor step and reports completion", async () => {
    window.history.pushState(null, "", "/?two_factor_required=1");
    const account = makeAccount(vi.fn());
    const onClose = vi.fn();
    const onSignedIn = vi.fn();
    const user = userEvent.setup();
    render(<SignInDialog open account={account} onClose={onClose} onSignedIn={onSignedIn} />);

    expect(screen.getByText("Two-factor authentication")).toBeTruthy();
    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(account.signInTwoFactor).toHaveBeenCalledWith({ code: "123456", rememberClient: false });
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(window.location.search).toBe("");
  });
});
