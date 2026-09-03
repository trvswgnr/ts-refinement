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
  {
    directory: "packages/ttsc-plugin",
    name: "@ts-refinement/ttsc",
    profile: "esm-only",
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
      packageDefinition.name === "ts-refinement" ||
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
  assert.deepEqual(manifests.get("ts-refinement").exports, {
    ".": { types: "./dist/index.d.mts" },
  });
  assert.equal(manifests.get("ts-refinement").main, undefined);
  assert.equal(manifests.get("ts-refinement").module, undefined);
  assert.deepEqual(manifests.get("ts-refinement")["ts-refinement"], {
    verify: { outDir: "dist" },
  });
  assert.equal(
    manifests.get("ts-refinement").scripts.prepack,
    "bun run build && bun run --cwd ../cli build && ts-refinement verify dist",
  );
  assert.deepEqual(manifests.get("@ts-refinement/runtime").dependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/runtime").optionalDependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/runtime").peerDependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/analyzer").dependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/cli").dependencies, {
    acorn: "^8.18.0",
    "acorn-walk": "^8.3.5",
    valibot: "1.4.2",
  });
  assert.equal(manifests.get("@ts-refinement/cli").peerDependencies, undefined);
  assert.deepEqual(manifests.get("@ts-refinement/typescript-plugin").dependencies, {
    "@ts-refinement/analyzer": "0.1.0",
  });
  assert.deepEqual(manifests.get("@ts-refinement/ttsc").dependencies, undefined);
  assert.equal(
    manifests.get("@ts-refinement/ttsc").peerDependencies["ts-refinement"],
    manifests.get("ts-refinement").version,
  );
  assert.equal(
    manifests.get("@ts-refinement/ttsc").peerDependencies["@ts-refinement/runtime"],
    manifests.get("@ts-refinement/runtime").version,
  );
  assert.deepEqual(manifests.get("@ts-refinement/rolldown").dependencies, {
    "@ts-refinement/unplugin": "0.1.0",
  });
  assert.deepEqual(manifests.get("@ts-refinement/unplugin").dependencies, {
    "@ts-refinement/analyzer": "0.1.0",
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
  const legacyArtifacts = artifacts.filter((artifact) => artifact.name !== "@ts-refinement/ttsc");
  await install(consumerDirectory, [
    ...legacyArtifacts.map((artifact) => artifact.tarball),
    "rolldown@1.2.6",
    "ts-patch@4.0.1",
    "typescript@6.0.3",
    "vitest@4.1.11",
  ]);
  const tspc = join(consumerDirectory, "node_modules", ".bin", "tspc");
  const vitest = join(consumerDirectory, "node_modules", ".bin", "vitest");
  const refinement = join(consumerDirectory, "node_modules", ".bin", "ts-refinement");
  await run(
    "node",
    ["-e", 'require("@ts-refinement/typescript-plugin/transformer")'],
    consumerDirectory,
  );
  await run(tspc, ["--project", "tsconfig.json"], consumerDirectory);
  await run(tspc, ["--project", "tsconfig.emit.json"], consumerDirectory);
  const tspcOutput = await readFile(
    join(consumerDirectory, "tspc-dist", "refinement-build.js"),
    "utf8",
  );
  assert.match(tspcOutput, /function checkPositive\(value\)/u);
  assert.doesNotMatch(tspcOutput, /as Positive/u);
  await run(vitest, ["run", "--config", "vitest.config.ts"], consumerDirectory);

  const loaderRun = await run(
    process.execPath,
    [
      "--loader",
      "@ts-refinement/unplugin/loader",
      "--input-type=module",
      "--eval",
      'const module = await import("./refinement-build.ts"); console.log(module.checkPositive(2)); try { module.checkPositive(-1); } catch (error) { console.log(error.name, error.value); }',
    ],
    consumerDirectory,
  );
  assert.match(loaderRun.stdout, /2\nRefinementError -1\n/u);

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
        plugins: [
          {
            transform: "@ts-refinement/typescript-plugin/transformer",
            transformProgram: true,
          },
        ],
        strict: true,
        target: "ES2022",
      },
      files: ["cli-invalid.ts"],
    })}\n`,
  );
  await assert.rejects(
    run(tspc, ["--project", "cli-invalid-tsconfig.json"], consumerDirectory),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stdout, /error TS2322:/u);
      assert.match(error.stdout, /RF1000200:/u);
      return true;
    },
  );
  await run("node", ["verify.mjs"], consumerDirectory);
  await run(refinement, ["verify", "dist"], consumerDirectory);
}

async function validateNativeInstall(temporaryDirectory, artifacts) {
  const consumerDirectory = join(temporaryDirectory, "native-consumer");
  await cp(join(repositoryRoot, "fixtures/package-consumer/native"), consumerDirectory, {
    recursive: true,
  });
  const requiredNames = [
    "ts-refinement",
    "@ts-refinement/cli",
    "@ts-refinement/runtime",
    "@ts-refinement/ttsc",
  ];
  const nativeArtifacts = requiredNames.map((name) => {
    const artifact = artifacts.find((candidate) => candidate.name === name);
    assert.ok(artifact, `Missing package artifact '${name}'.`);
    return artifact.tarball;
  });
  await install(consumerDirectory, [...nativeArtifacts, "ttsc@0.28.5", "typescript@7.0.2"]);
  const ttsc = join(consumerDirectory, "node_modules", ".bin", "ttsc");
  const refinement = join(consumerDirectory, "node_modules", ".bin", "ts-refinement");
  await run(ttsc, ["check", "--project", "tsconfig.json"], consumerDirectory);
  await run(
    ttsc,
    ["build", "--project", "tsconfig.json", "--emit", "--outDir", "dist"],
    consumerDirectory,
  );
  const emitted = await readFile(join(consumerDirectory, "dist", "index.js"), "utf8");
  assert.match(emitted, /known = 5;/u);
  assert.match(emitted, /new __ts_refinement_error/u);
  assert.doesNotMatch(emitted, /as Positive/u);
  await run(refinement, ["verify", "dist"], consumerDirectory);
}

await validateMetadata();
const temporaryDirectory = await mkdtemp(join(tmpdir(), "ts-refinement-packages-"));
try {
  const artifacts = await packAll(temporaryDirectory);
  await validateTarballs(artifacts);
  await validateMinimalInstall(temporaryDirectory, artifacts);
  await validateFullInstall(temporaryDirectory, artifacts);
  await validateNativeInstall(temporaryDirectory, artifacts);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
