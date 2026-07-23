import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { zipSync } from "fflate";

function collectFiles(rootDir, currentDir, files) {
  const entries = readdirSync(currentDir).sort((left, right) => left.localeCompare(right));
  for (const entry of entries) {
    const absolutePath = resolve(currentDir, entry);
    if (statSync(absolutePath).isDirectory()) {
      collectFiles(rootDir, absolutePath, files);
      continue;
    }
    const archivePath = relative(rootDir, absolutePath).split(sep).join("/");
    files[archivePath] = new Uint8Array(readFileSync(absolutePath));
  }
}

export function writeZipFromDirectory(sourceDir, zipPath) {
  const files = {};
  collectFiles(resolve(sourceDir), resolve(sourceDir), files);
  writeFileSync(zipPath, zipSync(files, { level: 9 }));
}

export function copyDirectory(sourceDir, destinationDir) {
  mkdirSync(destinationDir, { recursive: true });
  const entries = readdirSync(sourceDir).sort((left, right) => left.localeCompare(right));
  for (const entry of entries) {
    const source = join(sourceDir, entry);
    const destination = join(destinationDir, entry);
    if (statSync(source).isDirectory()) {
      copyDirectory(source, destination);
    } else {
      copyFileSync(source, destination);
    }
  }
}
