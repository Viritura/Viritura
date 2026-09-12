import assert from "node:assert/strict";
import test from "node:test";
import type { CommandOptions, CommandResult, CommandRunner } from "./commandRunner.ts";
import { DockerClient } from "./docker.ts";

interface Invocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly options: CommandOptions;
}

class RecordingRunner implements CommandRunner {
  readonly invocations: Invocation[] = [];
  result: CommandResult = { status: 0, stdout: "", stderr: "" };

  async run(executable: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandResult> {
    this.invocations.push({ executable, args, options });
    return this.result;
  }
}

test("Docker commands preserve argument boundaries and the Compose environment", async () => {
  const runner = new RecordingRunner();
  const environment = { VIRITURA_API_ENV_FILE: "/state/path with spaces/api.env" };
  const docker = new DockerClient(runner, "/workspace/repo", environment);

  await docker.compose(["-f", "/workspace/repo/infra/dev/worktree/docker-compose.yml", "up", "-d"]);

  assert.deepEqual(runner.invocations, [
    {
      executable: "docker",
      args: ["compose", "-f", "/workspace/repo/infra/dev/worktree/docker-compose.yml", "up", "-d"],
      options: { cwd: "/workspace/repo", env: environment },
    },
  ]);
});

test("Docker availability failures provide actionable guidance", async () => {
  const runner = new RecordingRunner();
  runner.result = { status: 127, stdout: "", stderr: "docker not found" };
  const docker = new DockerClient(runner, "/workspace/repo", {});

  await assert.rejects(() => docker.requireEngine(), /Docker is not available/);
  assert.deepEqual(runner.invocations[0]?.args, ["info"]);
  assert.equal(runner.invocations[0]?.options.capture, true);
  assert.equal(runner.invocations[0]?.options.allowFailure, true);
});
