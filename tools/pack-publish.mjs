/**
 * Stage a publish-ready copy of this package under `.publish/`.
 *
 * The working tree is the development copy: it is `"private": true`, it is what the
 * local DSH profile links against, and `npm publish` refuses to run in it. Publishing
 * always goes through this script, so a stray `npm publish` in the repository cannot
 * ship half-finished work.
 *
 *     npm run pack:publish          # writes .publish/
 *     npm publish .publish          # the only sanctioned publish path
 *
 * The staging step refuses to run on a dirty working tree, so what lands on the
 * registry is always exactly a commit.
 *
 * @module dsh-backdrop/tools/pack-publish
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".publish");

function fail(message) {
	console.error("\n" + message + "\n");
	process.exit(1);
}

/* 1. What gets published must be a commit, not a work in progress. */
let dirty = "";
try {
	dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
} catch (err) {
	fail("Could not read git status. Stage from a git working copy.\n" + err.message);
}
if (dirty.length > 0) {
	fail("Working tree is dirty — commit first:\n\n" + dirty);
}

/* 2. Copy exactly the files the manifest declares. */
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (manifest.private !== true) {
	fail('The working tree manifest must stay "private": true — that is the guard that\nblocks publishing from the repository itself.');
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copied = [];
for (const entry of manifest.files ?? []) {
	const from = path.join(root, entry);
	if (!fs.existsSync(from)) fail(`Declared file is missing: ${entry}`);
	fs.cpSync(from, path.join(out, entry), { recursive: true });
	copied.push(entry);
}
/* npm always ships these; keep the staging directory self-contained anyway. */
for (const extra of ["package.json"]) {
	fs.copyFileSync(path.join(root, extra), path.join(out, extra));
}

/* 3. Drop the private guard in the staged copy only. */
const staged = { ...manifest };
delete staged.private;
delete staged.scripts.prepublishOnly;
staged.scripts = { ...staged.scripts };
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify(staged, null, 2) + "\n", "utf8");

const version = staged.version;
console.log("Staged " + staged.name + "@" + version + " in .publish/");
console.log("  files: " + copied.join(", "));
console.log("\nNext:\n  npm publish .publish --access public\n");
