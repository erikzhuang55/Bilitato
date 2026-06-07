import { copyFileSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const manifestPath = join(rootDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = String(manifest.version || "").trim();

if (!version) {
  throw new Error("manifest.json 缺少 version，无法打包。");
}

const distDir = join(rootDir, "dist");
const legacyReleaseName = `bilitato-v${version}`;

const releaseTargets = {
  chrome: {
    reviewUrl: "https://chromewebstore.google.com/detail/bilitato-ai%E9%99%AA%E4%BD%A0%E7%9C%8Bb%E7%AB%99/ggddcgdafeeoijoaohcffinbefcbpcga/reviews"
  },
  edge: {
    reviewUrl: process.env.BILITATO_EDGE_REVIEW_URL || "https://microsoftedge.microsoft.com/addons/search/bilitato"
  }
};

const targetArg = process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1] || "all";
const targets = targetArg === "all" ? Object.keys(releaseTargets) : [targetArg];

for (const target of targets) {
  if (!releaseTargets[target]) {
    throw new Error(`未知打包目标：${target}。可选值：chrome、edge、all。`);
  }
}

const files = [
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "inject.js",
  "logger.js",
  "html2canvas.min.js",
  "markdownRenderer.js",
  "storeConfig.js",
  "permission-request.html",
  "permission-request.js",
  "rules.json",
  "subtitleProcessor.js"
];

const directories = [
  "_locales",
  "assets",
  "content",
  "utils"
];

function copyRequiredFile(relativePath, releaseDir) {
  const source = join(rootDir, relativePath);
  if (!existsSync(source)) {
    throw new Error(`缺少上架必需文件：${relativePath}`);
  }
  copyFileSync(source, join(releaseDir, basename(relativePath)));
}

function copyRequiredDirectory(relativePath, releaseDir) {
  const source = join(rootDir, relativePath);
  const destination = join(releaseDir, relativePath);
  if (!existsSync(source)) {
    throw new Error(`缺少上架必需目录：${relativePath}`);
  }
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "$ErrorActionPreference='Stop'; Copy-Item -LiteralPath $env:COPY_SOURCE -Destination $env:COPY_DESTINATION -Recurse -Force"
  ], {
    stdio: "inherit",
    env: {
      ...process.env,
      COPY_SOURCE: source,
      COPY_DESTINATION: destination
    }
  });
}

function writeStoreConfig(target, releaseDir) {
  const config = releaseTargets[target];
  const content = `globalThis.BILITATO_STORE_CONFIG = ${JSON.stringify({
    target,
    reviewUrl: config.reviewUrl
  }, null, 2)};\n`;
  writeFileSync(join(releaseDir, "storeConfig.js"), content, "utf8");
}

function buildRelease(target) {
  const releaseName = `bilitato-${target}-v${version}`;
  const releaseDir = join(distDir, releaseName);
  const zipPath = join(distDir, `${releaseName}.zip`);

  rmSync(releaseDir, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  mkdirSync(releaseDir, { recursive: true });

  files.forEach((file) => copyRequiredFile(file, releaseDir));
  directories.forEach((directory) => copyRequiredDirectory(directory, releaseDir));
  writeStoreConfig(target, releaseDir);

  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "$ErrorActionPreference='Stop'; $source = Join-Path $env:RELEASE_DIR '*'; Compress-Archive -Path $source -DestinationPath $env:RELEASE_ZIP -Force"
  ], {
    stdio: "inherit",
    env: {
      ...process.env,
      RELEASE_DIR: releaseDir,
      RELEASE_ZIP: zipPath
    }
  });
  console.log(`Release package ready: ${zipPath}`);
}

try {
  rmSync(join(distDir, legacyReleaseName), { recursive: true, force: true });
  rmSync(join(distDir, `${legacyReleaseName}.zip`), { force: true });

  for (const target of targets) {
    buildRelease(target);
  }
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
}
