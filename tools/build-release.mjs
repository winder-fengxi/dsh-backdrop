/**
 * Stage a publish-ready copy of this package under `release/`.
 *
 * The working tree is the development copy: it is `"private": true`, it is what the
 * local DSH profile links against, and `npm publish` refuses to run in it. Publishing
 * always goes through this script, so a stray `npm publish` in the repository cannot
 * ship half-finished work.
 *
 *     npm run build:release          # writes release/
 *     npm publish release          # the only sanctioned publish path
 *
 * The staging step refuses to run on a dirty working tree, so what lands on the
 * registry is always exactly a commit.
 *
 * @module dsh-backdrop/tools/build-release
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "release");

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
	fail("Working tree is dirty 鈥?commit first:\n\n" + dirty);
}

/* 2. Copy exactly the files the manifest declares. */
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (manifest.private !== true) {
	fail('The working tree manifest must stay "private": true 鈥?that is the guard that\nblocks publishing from the repository itself.');
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copied = [];
/**
 * Expand one `files` entry into concrete paths.
 *
 * npm accepts globs in `files` (`locale/*.json`), so the stager has to as well —
 * treating an entry as a literal path fails the build with a confusing
 * "declared file is missing".
 */
function expand(entry) {
	if (!entry.includes("*")) return [entry];
	let acc = [""];
	for (const segment of entry.split("/")) {
		const next = [];
		for (const base of acc) {
			if (!segment.includes("*")) {
				next.push(base === "" ? segment : base + "/" + segment);
				continue;
			}
			const dir = path.join(root, base === "" ? "." : base);
			if (!fs.existsSync(dir)) continue;
			const pattern = new RegExp(
				"^" + segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
				"u",
			);
			for (const name of fs.readdirSync(dir)) {
				if (pattern.test(name)) next.push(base === "" ? name : base + "/" + name);
			}
		}
		acc = next;
	}
	return acc;
}

for (const entry of manifest.files ?? []) {
	const matches = expand(entry);
	if (matches.length === 0) fail(`Declared file is missing: ${entry}`);
	for (const rel of matches) {
		const from = path.join(root, rel);
		if (!fs.existsSync(from)) fail(`Declared file is missing: ${rel}`);
		fs.cpSync(from, path.join(out, rel), { recursive: true });
		copied.push(rel);
	}
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
console.log("Staged " + staged.name + "@" + version + " in release/");
console.log("  files: " + copied.join(", "));
console.log("\nNext:\n  npm publish release --access public\n");
