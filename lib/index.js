/**
 * dsh-backdrop — host half.
 *
 * The host exists for exactly one reason: the browser half needs somewhere durable
 * to keep its settings, and a DSH plugin's configuration belongs to the Host.
 * Everything the user actually sees — the wallpaper, the per-section images, the
 * settings panel — is client-side.
 *
 * Where the configuration lives, in order of preference:
 *
 *  A. **The official settings layer.** `ctx.settings.update(entryId, patch)` merges the
 *     change into this plugin's own row in the profile patch
 *     (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`). The configuration is then a
 *     readable, hand-editable, version-controllable YAML block, and the platform's own
 *     settings surfaces recognise it. It is read back with `ctx.settings.describe()`.
 *
 *  B. **A standalone file.** When the runtime exposes no settings service the
 *     configuration falls back to `$DSH_HOME/dsh-backdrop/config.json`.
 *
 * Both paths are the same interface to the browser (`GET` / `PUT
 * /dsh-backdrop/config.json`), so the client never needs to know which one is in use.
 *
 * Why not `ctx.storageDomain`: it is the official durable-storage API, but
 * `defineDomain` requires zod record schemas and zod's major version differs between
 * runtimes. A plugin's settings are user-editable configuration rather than domain
 * records, so the settings layer is the right home regardless.
 *
 * Nothing here may take the profile down: every step degrades to "the configuration
 * did not sync" on failure.
 *
 * @module dsh-backdrop
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const name = "dsh-backdrop";
export const inject = ["webServer"];

const CONFIG_ROUTE = "/dsh-backdrop/config.json";

/** Id of this plugin's row in the profile patch (see cordis.patch.yml). */
const ENTRY_ID = "dsh-backdrop";

/** Reject absurd bodies. Images live in the browser's IndexedDB and never come here. */
const MAX_CONFIG_BYTES = 256 * 1024;

/**
 * Resolve the DSH home with the same precedence as the official
 * `@deepseek-ai/dsh-home-paths` (`$DSH_HOME`, then `~/.dsh`).
 *
 * This is spelled out rather than imported on purpose: a static ESM import that fails
 * to resolve takes the whole plugin down with it, and the rule is three lines.
 *
 * @returns {string} absolute harness home.
 */
function dshHome() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return resolve(fromEnv.trim());
	return join(homedir(), ".dsh");
}

/** @returns {string|null} path of the fallback configuration file. */
function configFile() {
	try {
		return join(dshHome(), "dsh-backdrop", "config.json");
	} catch (err) {
		return null;
	}
}

/* --------------------------- fallback file --------------------------- */

function readConfigFile() {
	const file = configFile();
	if (file === null || !existsSync(file)) return {};
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch (err) {
		console.warn("[dsh-backdrop] config file unreadable:", err);
		return {};
	}
}

function writeConfigFile(value) {
	const file = configFile();
	if (file === null) throw new Error("harness home is unresolved");
	mkdirSync(dirname(file), { recursive: true });
	const text = JSON.stringify(value, null, 2);
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, text, "utf8");
	try {
		renameSync(tmp, file); /* same-directory rename is atomic */
	} catch (err) {
		writeFileSync(file, text, "utf8");
		try { unlinkSync(tmp); } catch { /* ignore */ }
	}
}

/* --------------------------- settings layer --------------------------- */

/**
 * Look the settings service up instead of declaring it in `inject`: the plugin must
 * still mount when the service is absent, it just loses platform-backed persistence.
 *
 * @param {object} ctx - plugin context.
 * @returns {object|undefined} the settings service, when it is usable.
 */
function settingsService(ctx) {
	try {
		const svc = typeof ctx.get === "function" ? ctx.get("settings") : undefined;
		if (svc && typeof svc.update === "function" && typeof svc.describe === "function") return svc;
	} catch (err) {
		/* not ready yet */
	}
	return undefined;
}

/** @returns {Promise<object|undefined>} this entry's user layer, or undefined when unavailable. */
async function readConfigViaSettings(ctx) {
	const svc = settingsService(ctx);
	if (!svc) return undefined;
	try {
		const forms = await svc.describe({});
		if (!Array.isArray(forms)) return undefined;
		const mine = forms.find((f) => f && f.id === ENTRY_ID);
		if (!mine) return {};
		if (mine.user !== undefined) return mine.user;
		if (mine.value !== undefined) return mine.value;
		return {};
	} catch (err) {
		console.warn("[dsh-backdrop] settings read failed:", err);
		return undefined;
	}
}

/** @returns {Promise<boolean>} whether the official layer accepted the write. */
async function writeConfigViaSettings(ctx, patch) {
	const svc = settingsService(ctx);
	if (!svc) return false;
	try {
		await svc.update(ENTRY_ID, patch);
		return true;
	} catch (err) {
		console.warn("[dsh-backdrop] settings write failed:", err);
		return false;
	}
}

/* ------------------------------- route ------------------------------- */

function readBody(req) {
	return new Promise((settle, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_CONFIG_BYTES) {
				reject(new Error("config too large"));
				try { req.destroy(); } catch { /* ignore */ }
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => settle(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function sendJson(res, status, body) {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": String(Buffer.byteLength(text)),
		"cache-control": "no-store"
	});
	res.end(text);
}

function registerConfigRoute(ctx) {
	return ctx.webServer.register({
		kind: "exact",
		path: CONFIG_ROUTE,
		handler: (req, res) => {
			const method = req.method || "GET";
			try {
				if (method === "GET" || method === "HEAD") {
					readConfigViaSettings(ctx)
						.then((viaSettings) => {
							sendJson(res, 200, viaSettings !== undefined ? viaSettings : readConfigFile());
						})
						.catch(() => sendJson(res, 200, readConfigFile()));
					return;
				}
				if (method === "PUT" || method === "POST") {
					readBody(req)
						.then(async (text) => {
							let parsed;
							try {
								parsed = JSON.parse(text);
							} catch {
								sendJson(res, 400, { ok: false, error: "invalid json" });
								return;
							}
							if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
								sendJson(res, 400, { ok: false, error: "config must be a json object" });
								return;
							}
							if (await writeConfigViaSettings(ctx, parsed)) {
								sendJson(res, 200, { ok: true, store: "settings" });
								return;
							}
							sendJson(res, 200, { ok: true, store: "file", file: writeConfigFile(parsed) });
						})
						.catch((err) => sendJson(res, 413, { ok: false, error: String((err && err.message) || err) }));
					return;
				}
				sendJson(res, 405, { ok: false, error: "method not allowed" });
			} catch (err) {
				sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
			}
		}
	});
}

export function apply(ctx) {
	try {
		ctx.effect(() => registerConfigRoute(ctx), "dsh-backdrop: config route");
	} catch (err) {
		console.warn("[dsh-backdrop] config route skipped:", err);
	}
}
