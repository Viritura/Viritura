import type { IsoGitFs } from "./fs/types";

const CONFIG_PATH = "/.git/config";

export async function removeRemoteConfig(fs: IsoGitFs, remote: string): Promise<void> {
  const config = await fs.readFile(CONFIG_PATH, { encoding: "utf8" });
  const text = String(config);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const sectionHeader = `[remote "${remote.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`;
  const sections: string[][] = [[]];

  for (const line of lines) {
    if (/^\s*\[/.test(line)) sections.push([line]);
    else sections.at(-1)!.push(line);
  }

  const output: string[] = [];
  for (const section of sections) {
    const header = section[0]?.trim();
    if (header === sectionHeader) continue;
    if (header && /^\[branch\s+"/i.test(header)) {
      const tracksRemote = section.some((line) => {
        const match = /^\s*remote\s*=\s*(.*?)\s*$/i.exec(line);
        return match?.[1] === remote;
      });
      if (tracksRemote) {
        const filtered = section.filter((line, index) => index === 0 || !/^\s*(?:remote|merge)\s*=/i.test(line));
        if (filtered.slice(1).some((line) => line.trim())) output.push(...filtered);
        continue;
      }
    }
    output.push(...section);
  }

  await fs.writeFile(CONFIG_PATH, output.join(newline), { encoding: "utf8" });
}
