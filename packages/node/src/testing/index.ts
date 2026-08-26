import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export interface FixtureFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface PackageFixture {
  readonly root: string;
  readonly files: readonly FixtureFile[];
  readJson(path: string): unknown;
}

async function collectFiles(
  root: string,
  directory: string,
): Promise<FixtureFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: FixtureFile[] = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink())
      throw new Error(`Fixture contains a symbolic link: ${path}`);
    if (metadata.isDirectory()) {
      files.push(...(await collectFiles(root, path)));
    } else if (metadata.isFile()) {
      files.push({
        path: relative(root, path).split(sep).join("/"),
        bytes: new Uint8Array(await readFile(path)),
      });
    }
  }

  return files;
}

export async function loadPackageFixture(
  packageRoot: string,
): Promise<PackageFixture> {
  const root = resolve(packageRoot);
  if (!root.endsWith(".dstar"))
    throw new Error(`Fixture root must end in .dstar: ${root}`);
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Fixture root must be a regular directory: ${root}`);
  }

  const files = Object.freeze(await collectFiles(root, root));
  const filesByPath = new Map(files.map((file) => [file.path, file]));

  return Object.freeze({
    root,
    files,
    readJson(path: string): unknown {
      const file = filesByPath.get(path);
      if (!file) throw new Error(`Fixture file not found: ${path}`);
      return JSON.parse(new TextDecoder().decode(file.bytes));
    },
  });
}

export function minimalFixturePath(repositoryRoot: string): string {
  return join(resolve(repositoryRoot), "spec/0.1/examples/minimal.dstar");
}

export async function loadMinimalFixture(
  repositoryRoot: string,
): Promise<PackageFixture> {
  return loadPackageFixture(minimalFixturePath(repositoryRoot));
}
