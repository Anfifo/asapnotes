// Assembles THIRD-PARTY-NOTICES.txt from three parts: the hand-kept notices for
// native code no package names (manual.txt), every Rust crate of the app and the
// transcription engine (cargo-about), and the npm packages `vite build` put into
// the frontend bundle (dist/third-party-npm.txt). Run through `npm run notices`.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n").trim();

// cargo-about refuses to print into a PowerShell pipe, so it writes a file.
execFileSync(
  "cargo",
  [
    "about",
    "generate",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--features",
    "transcribe",
    "-c",
    "notices/about.toml",
    "-o",
    "dist/third-party-rust.txt",
    "notices/about.hbs",
  ],
  { stdio: "inherit" },
);
const rust = read("dist/third-party-rust.txt");

const header = `asapnotes third-party notices

asapnotes is released under the MIT License (see LICENSE). The installed app and
the transcription engine it downloads on request include the open-source
software listed below, each under its own license.`;

const section = (title) => `\n\n${"=".repeat(80)}\n${title}\n${"=".repeat(80)}\n`;

writeFileSync(
  "THIRD-PARTY-NOTICES.txt",
  header +
    "\n\n" +
    read("notices/manual.txt") +
    section("Rust crates") +
    rust +
    section("npm packages in the interface bundle") +
    "\n" +
    read("dist/third-party-npm.txt") +
    "\n",
);
