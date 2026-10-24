import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Isolate real modules beside the SDK packages supplied by each test. */
export async function createModuleHarness(
  modules: Readonly<Record<string, URL>>,
  packages: (directory: string) => Readonly<Record<string, Readonly<Record<string, string>>>>,
) {
  const directory = await mkdtemp(join(tmpdir(), "pi-module-test-"));
  for (const [name, source] of Object.entries(modules)) {
    const destination = join(directory, name);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  for (const [name, files] of Object.entries(packages(directory))) {
    for (const [file, content] of Object.entries(files)) {
      const destination = join(directory, "node_modules", name, file);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
    }
  }
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
    importModule: (name: string) => import(pathToFileURL(join(directory, name)).href),
  };
}
