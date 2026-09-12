import type { CommandRunner } from "./commandRunner.ts";

export class DockerClient {
  readonly #runner: CommandRunner;
  readonly #cwd: string;
  readonly #env: NodeJS.ProcessEnv;

  constructor(runner: CommandRunner, cwd: string, env: NodeJS.ProcessEnv) {
    this.#runner = runner;
    this.#cwd = cwd;
    this.#env = env;
  }

  async isAvailable(): Promise<boolean> {
    const result = await this.#runner.run("docker", ["info"], {
      allowFailure: true,
      capture: true,
      cwd: this.#cwd,
      env: this.#env,
    });
    return result.status === 0;
  }

  async requireEngine(): Promise<void> {
    if (await this.isAvailable()) return;
    const guidance =
      process.platform === "linux"
        ? "Start Docker Engine or a compatible Docker service and retry."
        : "Start Docker Desktop or a compatible Docker service and retry.";
    throw new Error(`Docker is not available. ${guidance}`);
  }

  async run(args: readonly string[], options: { capture?: boolean; allowFailure?: boolean } = {}) {
    return this.#runner.run("docker", args, {
      ...options,
      cwd: this.#cwd,
      env: this.#env,
    });
  }

  async compose(args: readonly string[]): Promise<void> {
    await this.run(["compose", ...args]);
  }

  async succeeds(args: readonly string[]): Promise<boolean> {
    return (await this.run(args, { allowFailure: true, capture: true })).status === 0;
  }

  async output(args: readonly string[]): Promise<string> {
    return (await this.run(args, { capture: true })).stdout.trim();
  }

  async ids(args: readonly string[]): Promise<string[]> {
    const output = await this.output(args);
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  }
}
