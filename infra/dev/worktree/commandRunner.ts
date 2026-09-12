import { spawn } from "node:child_process";

export interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly capture?: boolean;
  readonly allowFailure?: boolean;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface CommandRunner {
  run(executable: string, args: readonly string[], options?: CommandOptions): Promise<CommandResult>;
}

export class SystemCommandRunner implements CommandRunner {
  async run(executable: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandResult> {
    return new Promise((resolveCommand, rejectCommand) => {
      const capture = options.capture ?? false;
      const child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
      });

      const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal);
      const onSigint = () => forwardSignal("SIGINT");
      const onSigterm = () => forwardSignal("SIGTERM");
      process.once("SIGINT", onSigint);
      process.once("SIGTERM", onSigterm);

      const cleanUpListeners = () => {
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigterm);
      };
      child.once("error", (error) => {
        cleanUpListeners();
        if (options.allowFailure) {
          resolveCommand({ status: 127, stdout, stderr: error.message });
        } else {
          rejectCommand(error);
        }
      });
      child.once("close", (status) => {
        cleanUpListeners();
        const result = { status: status ?? 1, stdout, stderr };
        if (result.status !== 0 && !options.allowFailure) {
          rejectCommand(new Error(`${executable} failed (exit ${result.status}): ${args.join(" ")}`));
        } else {
          resolveCommand(result);
        }
      });
    });
  }
}
