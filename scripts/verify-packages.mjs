import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const packages = [
  { directory: "packages/core", name: "ts-refinement", profile: "esm-only" },
  {
    directory: "packages/analyzer",
    name: "@ts-refinement/analyzer",
    profile: "esm-only",
  },
  { directory: "packages/cli", name: "@ts-refinement/cli", profile: "esm-only" },
  { directory: "packages/runtime", name: "@ts-refinement/runtime", profile: "esm-only" },
  { directory: "packages/unplugin", name: "@ts-refinement/unplugin", profile: "esm-only" },
  {
    directory: "packages/rolldown-plugin",
    name: "@ts-refinement/rolldown",
    profile: "esm-only",
  },
  {
    directory: "packages/typescript-plugin",
    name: "@ts-refinement/typescript-plugin",
    profile: "node16",
  },
];

async function run(command, arguments_, cwd = repositoryRoot) {
  return execFileAsync(command, arguments_, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function readManifest(directory) {
  const source = await readFile(join(repositoryRoot, directory, "package.json"), "utf8");
  return JSON.parse(source);
}

async function packAll(packDirectory) {
  const artifacts = [];
  for (const packageDefinition of packages) {
    const { stdout } = await run("npm", [
      "pack",
      resolve(repositoryRoot, packageDefinition.directory),
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      packDirectory,
    ]);
    const [result] = JSON.parse(stdout);
    assert.equal(result.name, packageDefinition.name);
    assert.ok(result.files.some((file) => file.path === "LICENSE"));
    assert.ok(result.files.some((file) => file.path === "README.md"));
    assert.ok(
      result.files.some((file) => file.path === "dist/index.mjs") ||
        packageDefinition.profile === "node16",
    );
    artifacts.push({
      ...packageDefinition,
      tarball: join(packDirectory, basename(result.filename)),
    });
  }
  return artifacts;
}

async function validateMetadata() {
  const manifests = new Map(
    await Promise.all(
      packages.map(async (packageDefinition) => [
        packageDefinition.name,
        await readManifest(packageDefinition.directory),
      ]),
    ),
  );
  assert.deepEqual(
    [...new Set([...manifests.values()].map((manifest) => manifest.version))],
    ["0.1.0"],
  );
  assert.deepEqual(manifests.get("ts-refinement").dependencies, undefined);
  assert.deepEqual(manifests.get("ts-refinement").optionalDependencies, undefined);
  assert.deepEqual(manifests.get("ts-refinement").peerDependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/runtime").dependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/runtime").optionalDependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/runtime").peerDependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/analyzer").dependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/cli").dependencies, undefined);
  assert.equal(
    manifests.get("@ts-refinement/cli").peerDependencies["ts-refinement"],
    manifests.get("ts-refinement").version,
  );
  assert.deepEqual(manifests.get("@ts-refinement/typescript-plugin").dependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/rolldown").dependencies, {
    "@ts-refinement/unplugin": "0.1.0",
  });
  assert.deepEqual(manifests.get("@ts-refinement/unplugin").dependencies, {
    "magic-string": "^0.30.21",
    unplugin: "^3.3.0",
  });
  assert.equal(
    manifests.get("@ts-refinement/rolldown").peerDependencies["@ts-refinement/runtime"],
    manifests.get("@ts-refinement/runtime").version,
  );
  assert.equal(
    manifests.get("@ts-refinement/rolldown").peerDependencies["ts-refinement"],
    manifests.get("ts-refinement").version,
  );
  assert.equal(
    manifests.get("@ts-refinement/typescript-plugin").peerDependencies["ts-refinement"],
    manifests.get("ts-refinement").version,
  );
}

async function validateTarballs(artifacts) {
  await Promise.all(
    artifacts.flatMap((artifact) => [
      run("publint", [artifact.tarball, "--strict"]),
      run("attw", [artifact.tarball, "--profile", artifact.profile]),
    ]),
  );
}

async function install(consumerDirectory, specifications) {
  await run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...specifications],
    consumerDirectory,
  );
}

async function validateMinimalInstall(temporaryDirectory, artifacts) {
  const consumerDirectory = join(temporaryDirectory, "minimal-consumer");
  const core = artifacts.find((artifact) => artifact.name === "ts-refinement");
  const runtime = artifacts.find((artifact) => artifact.name === "@ts-refinement/runtime");
  assert.ok(core);
  assert.ok(runtime);
  await cp(join(repositoryRoot, "fixtures/package-consumer/minimal"), consumerDirectory, {
    recursive: true,
  });
  await install(consumerDirectory, [core.tarball, runtime.tarball]);
  await run("node", ["index.mjs"], consumerDirectory);
  const tree = JSON.parse((await run("npm", ["ls", "--all", "--json"], consumerDirectory)).stdout);
  const installedPackages = new Set();
  const pending = [tree];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const [name, dependency] of Object.entries(current.dependencies ?? {})) {
      installedPackages.add(name);
      pending.push(dependency);
    }
  }
  assert.deepEqual(
    [...installedPackages].sort((left, right) => left.localeCompare(right)),
    ["@ts-refinement/runtime", "ts-refinement"],
  );
}

async function validateFullInstall(temporaryDirectory, artifacts) {
  const consumerDirectory = join(temporaryDirectory, "full-consumer");
  await cp(join(repositoryRoot, "fixtures/package-consumer/full"), consumerDirectory, {
    recursive: true,
  });
  await install(consumerDirectory, [
    ...artifacts.map((artifact) => artifact.tarball),
    "rolldown@1.2.6",
    "typescript@5.9.3",
  ]);
  const tsc = join(consumerDirectory, "node_modules", ".bin", "tsc");
  const refinement = join(consumerDirectory, "node_modules", ".bin", "ts-refinement");
  await run(tsc, ["--project", "tsconfig.json"], consumerDirectory);
  await run(refinement, ["check", "--project", "tsconfig.json"], consumerDirectory);

  await writeFile(
    join(consumerDirectory, "cli-invalid.ts"),
    `import type { Refined } from "ts-refinement";
type Positive = Refined<number, "n > 0">;
type GreaterThanFive = Refined<number, "n > 5">;
declare const positive: Positive;
export const inverse: GreaterThanFive = positive;
export const disproven = -1 as Positive;
`,
  );
  await writeFile(
    join(consumerDirectory, "cli-invalid-tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        lib: ["ESNext"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        strict: true,
        target: "ES2022",
      },
      files: ["cli-invalid.ts"],
    })}\n`,
  );
  await assert.rejects(
    run(refinement, ["check", "--project", "cli-invalid-tsconfig.json"], consumerDirectory),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /error TS2322:/u);
      assert.match(error.stdout, /error RF1200:/u);
      return true;
    },
  );
  await run("node", ["verify.mjs"], consumerDirectory);
}

await validateMetadata();
const temporaryDirectory = await mkdtemp(join(tmpdir(), "ts-refinement-packages-"));
try {
  const artifacts = await packAll(temporaryDirectory);
  await validateTarballs(artifacts);
  await validateMinimalInstall(temporaryDirectory, artifacts);
  await validateFullInstall(temporaryDirectory, artifacts);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
