window.__ModuleLoader__.load({ id: "dsh-backdrop", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

/* ------------------------------------------------------------------ *
 * dsh-backdrop — browser half
 *
 * 给 DSH Web GUI 加一层用户自己的图片：整体壁纸 + 分区背景、面板透明度、
 * 模糊、压暗、轮播，并可把当前图片设成界面图标（favicon）。
 *
 * 分层结构参考 VS Code 的 `shalldie.background`：
 *   一个全局开关 + 若干「界面区域」，每个区域同一套字段
 *   （images / opacity / size / position）。
 *   对应到 DSH 就是：
 *     整体背景  ←→ background.fullscreen
 *     左侧边栏  ←→ background.sidebar
 *     主内容区  ←→ background.editor
 *     右侧边栏  ←→ background.auxiliarybar
 *
 * 设计要点：
 *  - 图片存在浏览器 IndexedDB 里（二进制，不上传、不落盘到宿主）；
 *    配置存在宿主侧的 `$DSH_HOME/dsh-backdrop/config.json`，是一个普通文件，
 *    可以备份、进版本库、手改。浏览器这边只保留内存副本，paint() 全程同步。
 *  - 整体壁纸是 fixed + z-index:-1 的独立节点；三个分区各有一个同样定位的裁剪层，
 *    矩形由运行时量出来的列布局决定（见 measureRegions）。
 *  - 为什么分区不用「设计令牌」实现：DSH 各区域的背景确实来自 `--dsw-*` 令牌，
 *    但中间列与右栏本身没有自有背景（透出画布的 bg-base），令牌分不出它们是谁，
 *    也表达不了「界面区域」这个语义。矩形裁剪更直观，且与用户看到的分区一致。
 *  - 面板能透出后面的图，靠 `body` 上的 `!important` 令牌重绑（内联样式压不过
 *    `!important` 的作者样式表），取值前先把 class 摘掉读一次真实主题色。
 * ------------------------------------------------------------------ */

var React = require("react");
if (React && React.default && typeof React.createElement !== "function") React = React.default;
var h = React.createElement;

var NAME = "dsh-backdrop";
var NS = "settings.dsh-backdrop";
var CFG_KEY = "dsh-backdrop:config";
var CONFIG_URL = "/dsh-backdrop/config.json";
var DB_NAME = "dsh-backdrop";
var DB_STORE = "images";
var LAYER_ID = "dsh-wp-layer";
var REGION_ID = "dsh-wp-regions";
var STYLE_ID = "dsh-wp-global-style";

/* ---------------------------- 分区定义 ---------------------------- */
/**
 * 三个界面分区。整体背景由「整体背景」那张卡片负责，所以这里只有区域。
 */
var REGIONS = [
	{ id: "sidebar" },
	{ id: "main" },
	{ id: "aux" }
];

function regionDefaults() {
	return {
		on: false, own: false, imageId: null,
		/* 分区自己的图片有多实（100 = 完全盖住整体背景） */
		imgOpacity: 100,
		fit: "fill", focus: "center",
		blur: 0, dim: 0,
		brightness: 100, contrast: 100, saturate: 100
	};
}

var DEFAULTS = {
	/* 整体背景 */
	enabled: false,
	activeId: null,
	rotateMs: 0,
	shuffle: false,
	/* 显示 */
	fit: "fill",
	focus: "center",
	imgOpacity: 20,
	/* 效果 */
	blur: 0,
	dim: 0,
	brightness: 100,
	contrast: 100,
	saturate: 100,
	applyIcon: false,
	/* 分区 */
	regions: {}
};

/** 面板半透明要重绑的令牌（只负责让面板透出后面的图，与分区无关）。 */
var SURFACES = [
	"--dsw-alias-bg-base",
	"--dsw-alias-bg-layer-1",
	"--dsw-alias-bg-layer-2",
	"--dsw-alias-bg-layer-3",
	"--dsw-specific-sidebar-fill"
];

function defaultRegions() {
	var out = {};
	REGIONS.forEach(function (r) { out[r.id] = regionDefaults(); });
	return out;
}

var GLOBAL_CSS = [
	"#" + LAYER_ID + "{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;display:none}",
	"html.dsh-wp-on #" + LAYER_ID + "{display:block}",
	"#" + LAYER_ID + " .dsh-wp-img{position:absolute;inset:0;background-repeat:no-repeat;background-position:center center;background-size:cover;opacity:0;transition:opacity .7s ease}",
	"#" + LAYER_ID + " .dsh-wp-img.is-on{opacity:1}",
	"#" + LAYER_ID + " .dsh-wp-scrim{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .3s ease}",

	"#" + REGION_ID + "{position:fixed;inset:0;z-index:-1;pointer-events:none;display:none}",
	"html.dsh-wp-on #" + REGION_ID + "{display:block}",
	"#" + REGION_ID + " .dsh-wp-region{position:absolute;overflow:hidden;background-repeat:no-repeat;background-position:center center;background-size:cover;display:none;transition:opacity .3s ease}",
	"#" + REGION_ID + " .dsh-wp-region.is-on{display:block}",
	"#" + REGION_ID + " .dsh-wp-region .dsh-wp-rscrim{position:absolute;inset:0;background:#000;opacity:0}",

	"html.dsh-wp-on body{",
	"--dsw-alias-bg-base:color-mix(in srgb,var(--dsh-wp-t0,#fff) var(--dsh-wp-veil,86%),transparent)!important;",
	"--dsw-alias-bg-layer-1:color-mix(in srgb,var(--dsh-wp-t1,#fff) var(--dsh-wp-veil,86%),transparent)!important;",
	"--dsw-alias-bg-layer-2:color-mix(in srgb,var(--dsh-wp-t2,#fff) var(--dsh-wp-veil,86%),transparent)!important;",
	"--dsw-alias-bg-layer-3:color-mix(in srgb,var(--dsh-wp-t3,#fff) var(--dsh-wp-veil,86%),transparent)!important;",
	"--dsw-specific-sidebar-fill:color-mix(in srgb,var(--dsh-wp-t4,#fff) var(--dsh-wp-veil,86%),transparent)!important;",
	"}"
].join("\n");

var PANEL_CSS = [
	".dshwp-wrap{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary,#0f1115)}",
	".dshwp-intro{font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-tertiary,#6b7280)}",
	".dshwp-card{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}",
	".dshwp-cardtitle{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-primary,#0f1115)}",
	".dshwp-drop{border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:10px;padding:16px 12px;text-align:center;font-size:12.5px;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer;transition:border-color .15s ease,background .15s ease}",
	".dshwp-drop:hover{border-color:var(--dsw-alias-button-info-fill,#1772b4)}",
	".dshwp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}",
	".dshwp-thumb{position:relative;padding:0;border:2px solid transparent;border-radius:8px;overflow:hidden;cursor:pointer;background:none;aspect-ratio:16/10}",
	".dshwp-thumb img{width:100%;height:100%;object-fit:cover;display:block}",
	".dshwp-thumb.is-active{border-color:var(--dsw-alias-button-info-fill,#1772b4)}",
	".dshwp-thumb .dshwp-x{position:absolute;top:3px;right:3px;width:18px;height:18px;line-height:16px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:12px;text-align:center;cursor:pointer}",
	".dshwp-row{display:flex;align-items:center;gap:10px;font-size:12.5px}",
	".dshwp-row>span:first-child{flex:0 0 92px;color:var(--dsw-alias-label-secondary,#4b5563)}",
	".dshwp-row input[type=range]{flex:1;min-width:0}",
	".dshwp-val{flex:0 0 46px;text-align:right;color:var(--dsw-alias-label-tertiary,#6b7280);font-variant-numeric:tabular-nums}",
	".dshwp-btn{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:8px;background:none;color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;padding:4px 12px;cursor:pointer}",
	".dshwp-btn:hover{border-color:var(--dsw-alias-button-info-fill,#1772b4)}",
	".dshwp-btn[disabled]{opacity:.45;cursor:not-allowed}",
	".dshwp-actions{display:flex;gap:8px;flex-wrap:wrap}",
	".dshwp-check{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#4b5563)}",
	".dshwp-check input{flex:0 0 auto}",
	".dshwp-empty{font-size:12.5px;color:var(--dsw-alias-label-tertiary,#6b7280)}",
	".dshwp-sub{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#6b7280)}",
	".dshwp-tag{font-size:10.5px;padding:1px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));color:var(--dsw-alias-label-tertiary,#6b7280);white-space:nowrap}",
	".dshwp-tag.is-on{border-color:var(--dsw-alias-button-info-fill,#1772b4);color:var(--dsw-alias-button-info-fill,#1772b4)}",
	".dshwp-align{display:grid;grid-template-columns:repeat(3,22px);gap:3px;justify-content:start}",
	".dshwp-align button{width:22px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:5px;background:none;cursor:pointer;position:relative}",
	".dshwp-align button::after{content:'';position:absolute;inset:4px;border-radius:2px;background:var(--dsw-alias-label-tertiary,#9ca3af);opacity:.45}",
	".dshwp-align button.is-on{border-color:var(--dsw-alias-button-info-fill,#1772b4)}",
	".dshwp-align button.is-on::after{background:var(--dsw-alias-button-info-fill,#1772b4);opacity:1}",
	".dshwp-morehead{font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer;user-select:none}",
	".dshwp-morehead:hover{color:var(--dsw-alias-label-secondary,#4b5563)}"
].join("\n");

var log = function (m) { console.info("[" + NAME + "] " + m); };
var warn = function (m) { console.warn("[" + NAME + "] " + m); };

/* ----------------------------- state ----------------------------- */

var state = { cfg: Object.assign({}, DEFAULTS, { regions: defaultRegions() }), images: [] };
var subs = new Set();

function regionCfg(id) {
	if (!state.cfg.regions || typeof state.cfg.regions !== "object") state.cfg.regions = {};
	if (!state.cfg.regions[id]) state.cfg.regions[id] = regionDefaults();
	return state.cfg.regions[id];
}

function normalizeConfig(parsed) {
	var next = Object.assign({}, DEFAULTS, { regions: defaultRegions() });
	if (parsed && typeof parsed === "object") {
		Object.keys(DEFAULTS).forEach(function (k) {
			if (k === "regions") return;
			if (parsed[k] !== undefined) next[k] = parsed[k];
		});
		/* 旧版存的是「面板不透明度」(veil)，语义相反，换算成图片不透明度 */
		if (parsed.imgOpacity === undefined && parsed.veil !== undefined) {
			next.imgOpacity = Math.max(0, Math.min(60, 100 - Number(parsed.veil)));
		}
		var src = parsed.regions && typeof parsed.regions === "object" ? parsed.regions : {};
		REGIONS.forEach(function (def) {
			var base = regionDefaults();
			var got = src[def.id];
			if (got && typeof got === "object") {
				Object.keys(base).forEach(function (k) { if (got[k] !== undefined) base[k] = got[k]; });
				if (got.imgOpacity === undefined && got.opacity !== undefined) base.imgOpacity = got.opacity;
			}
			next.regions[def.id] = base;
		});
	}
	return next;
}

/**
 * 配置落在宿主侧的 `$DSH_HOME/dsh-backdrop/config.json`（见 lib/index.js），
 * 浏览器这边只保留内存副本 —— paint() 全程同步，不必等网络。
 *
 * 唯一残留的 localStorage 用途：把老版本存在浏览器里的配置搬过去（一次性）。
 */
function legacyConfig() {
	try {
		var raw = localStorage.getItem(CFG_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch (err) {
		return null;
	}
}

function loadConfig() {
	var legacy = legacyConfig();
	if (legacy) state.cfg = normalizeConfig(legacy);
}

function pushConfig() {
	try {
		return fetch(CONFIG_URL, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(state.cfg)
		}).then(function (res) {
			if (!res.ok) warn("config save rejected: HTTP " + res.status);
			return res;
		}).catch(function (err) { warn("config save failed: " + err); });
	} catch (err) {
		warn("config save unavailable: " + err);
		return Promise.resolve();
	}
}

var saveTimer = null;
/** 节流回写：拖滑块时不会每一帧都发请求。 */
function saveConfig() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(function () { saveTimer = null; pushConfig(); }, 400);
}

/** 启动时从宿主读回配置；没有就搬一次老配置，再没有就用默认值。 */
function fetchConfig() {
	return fetch(CONFIG_URL, { cache: "no-store" })
		.then(function (res) { return res.ok ? res.json() : null; })
		.then(function (remote) {
			var legacy = legacyConfig();
			if (remote && typeof remote === "object" && Object.keys(remote).length) {
				state.cfg = normalizeConfig(remote);
				try { localStorage.removeItem(CFG_KEY); } catch (err) { /* ignore */ }
			} else if (legacy) {
				state.cfg = normalizeConfig(legacy);
				pushConfig();
				try { localStorage.removeItem(CFG_KEY); } catch (err) { /* ignore */ }
				log("migrated browser config to the host file");
			} else {
				return;
			}
			paint({ recapture: true });
			scheduleRotation();
			notify();
		})
		.catch(function (err) { warn("config load failed: " + err); });
}

function notify() {
	subs.forEach(function (fn) { try { fn(); } catch (err) { warn("listener: " + err); } });
}

function findImage(id) {
	for (var i = 0; i < state.images.length; i++) if (state.images[i].id === id) return state.images[i];
	return null;
}

function activeImage() {
	return findImage(state.cfg.activeId) || (state.images.length ? state.images[0] : null);
}

/** 某个分区实际用的图片：自己指定就用自己的，否则跟随整体壁纸。 */
function imageForRegion(cfg) {
	if (cfg && cfg.own && cfg.imageId) {
		var own = findImage(cfg.imageId);
		if (own) return own;
	}
	return activeImage();
}

/* --------------------------- IndexedDB --------------------------- */

function openDb() {
	return new Promise(function (resolve, reject) {
		if (typeof indexedDB === "undefined") { reject(new Error("no indexedDB")); return; }
		var req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = function () {
			var db = req.result;
			if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: "id" });
		};
		req.onsuccess = function () { resolve(req.result); };
		req.onerror = function () { reject(req.error || new Error("open failed")); };
	});
}

function dbAll(db) {
	return new Promise(function (resolve, reject) {
		var tx = db.transaction(DB_STORE, "readonly");
		var req = tx.objectStore(DB_STORE).getAll();
		req.onsuccess = function () { resolve(req.result || []); };
		req.onerror = function () { reject(req.error); };
	});
}

function dbPut(db, rec) {
	return new Promise(function (resolve, reject) {
		var tx = db.transaction(DB_STORE, "readwrite");
		tx.objectStore(DB_STORE).put(rec);
		tx.oncomplete = function () { resolve(); };
		tx.onerror = function () { reject(tx.error); };
	});
}

function dbDel(db, id) {
	return new Promise(function (resolve, reject) {
		var tx = db.transaction(DB_STORE, "readwrite");
		tx.objectStore(DB_STORE).delete(id);
		tx.oncomplete = function () { resolve(); };
		tx.onerror = function () { reject(tx.error); };
	});
}

/* ------------------------- image pipeline ------------------------ */

function fileToDataUrl(file) {
	return new Promise(function (resolve, reject) {
		var fr = new FileReader();
		fr.onload = function () { resolve(String(fr.result)); };
		fr.onerror = function () { reject(fr.error || new Error("read failed")); };
		fr.readAsDataURL(file);
	});
}

/** 大图降到 maxSide 以内；小图原样保留（PNG 透明不被破坏）。 */
function downscale(dataUrl, maxSide, quality) {
	return new Promise(function (resolve) {
		var img = new Image();
		img.onload = function () {
			var w = img.naturalWidth || 0;
			var ht = img.naturalHeight || 0;
			var scale = Math.min(1, maxSide / Math.max(w || 1, ht || 1));
			if (scale >= 1 && dataUrl.length < 1600000) { resolve({ dataUrl: dataUrl, w: w, h: ht }); return; }
			try {
				var cw = Math.max(1, Math.round(w * scale));
				var ch = Math.max(1, Math.round(ht * scale));
				var c = document.createElement("canvas");
				c.width = cw; c.height = ch;
				c.getContext("2d").drawImage(img, 0, 0, cw, ch);
				var out = c.toDataURL("image/jpeg", quality);
				resolve({ dataUrl: out, w: cw, h: ch });
			} catch (err) { resolve({ dataUrl: dataUrl, w: w, h: ht }); }
		};
		img.onerror = function () { resolve({ dataUrl: dataUrl, w: 0, h: 0 }); };
		img.src = dataUrl;
	});
}

/**
 * 预模糊：分区背景是 CSS 背景，没法只对它下 `filter`（会把该区文字一起糊掉）。
 * 所以模糊在入图时用 canvas 烤进 data URL，每个分区各缓存一份。
 */
function blurDataUrl(dataUrl, radius, maxSide) {
	return new Promise(function (resolve) {
		var px = Math.max(0, Math.min(40, Number(radius) || 0));
		if (!px || typeof Image === "undefined") { resolve(dataUrl); return; }
		var img = new Image();
		img.onload = function () {
			try {
				var w = img.naturalWidth || 0, ht = img.naturalHeight || 0;
				var scale = Math.min(1, (maxSide || 2560) / Math.max(w || 1, ht || 1));
				var cw = Math.max(1, Math.round(w * scale));
				var ch = Math.max(1, Math.round(ht * scale));
				var c = document.createElement("canvas");
				c.width = cw; c.height = ch;
				var ctx2 = c.getContext("2d");
				/* 模糊会让边缘变透明，先把原图放大一点点铺满，避免白边 */
				var pad = px * 2;
				ctx2.filter = "blur(" + px + "px)";
				ctx2.drawImage(img, -pad, -pad, cw + pad * 2, ch + pad * 2);
				ctx2.filter = "none";
				resolve(c.toDataURL("image/jpeg", 0.82));
			} catch (err) { resolve(dataUrl); }
		};
		img.onerror = function () { resolve(dataUrl); };
		img.src = dataUrl;
	});
}

/** favicon 要小，单独压到 128px。 */
function makeIcon(dataUrl) {
	return new Promise(function (resolve) {
		var img = new Image();
		img.onload = function () {
			try {
				var s = 128;
				var c = document.createElement("canvas");
				c.width = s; c.height = s;
				var ctx2 = c.getContext("2d");
				var w = img.naturalWidth || s, ht = img.naturalHeight || s;
				var r = Math.max(s / w, s / ht);
				var dw = w * r, dh = ht * r;
				ctx2.drawImage(img, (s - dw) / 2, (s - dh) / 2, dw, dh);
				resolve(c.toDataURL("image/png"));
			} catch (err) { resolve(null); }
		};
		img.onerror = function () { resolve(null); };
		img.src = dataUrl;
	});
}

function persistImages() {
	return openDb().then(function (db) {
		return state.images.reduce(function (chain, rec) { return chain.then(function () { return dbPut(db, rec); }); }, Promise.resolve());
	});
}

/* ---------------------------- painting --------------------------- */

var dom = {
	layer: null, imgs: null, scrim: null, showing: 0, shownId: null,
	regionBox: null, regionEls: {},
	tints: null,
	iconCache: {}, originalFavicon: null, iconApplied: null,
	blurCache: {}, lastUrl: {},
	rects: null, rectsKey: ""
};

/** 九宫格对齐 → background-position。 */
var FOCUS_POS = {
	"top left": "left top", "top": "center top", "top right": "right top",
	"left": "left center", "center": "center center", "right": "right center",
	"bottom left": "left bottom", "bottom": "center bottom", "bottom right": "right bottom"
};

function bgPosition(focus) {
	return FOCUS_POS[focus] || "center center";
}

/**
 * 显示方式 → background-size。
 * 用 Windows 壁纸那套词（DESKTOP_WALLPAPER_POSITION）：
 *   填充 fill=cover / 适应 fit=contain / 拉伸 stretch=100% 100% / 平铺 tile=auto+repeat / 居中 center=auto
 */
function bgSize(fit) {
	if (fit === "fit") return "contain";
	if (fit === "stretch") return "100% 100%";
	if (fit === "tile" || fit === "center") return "auto";
	return "cover";
}

function bgRepeat(fit) {
	return fit === "tile" ? "repeat" : "no-repeat";
}

function clamp(v, lo, hi, dflt) {
	var n = Number(v);
	if (!isFinite(n)) n = dflt;
	return Math.max(lo, Math.min(hi, n));
}

/**
 * 图片效果 → CSS filter 串。
 * 模糊只有全屏那份能直接用（分区层模糊会糊出边界，所以那边改成入图时预烤）。
 */
function filterCss(cfg, withBlur) {
	var parts = [];
	if (withBlur) {
		var b = clamp(cfg.blur, 0, 24, 0);
		if (b) parts.push("blur(" + b + "px)");
	}
	var br = clamp(cfg.brightness, 20, 200, 100);
	var ct = clamp(cfg.contrast, 20, 200, 100);
	var sa = clamp(cfg.saturate, 0, 200, 100);
	if (br !== 100) parts.push("brightness(" + br + "%)");
	if (ct !== 100) parts.push("contrast(" + ct + "%)");
	if (sa !== 100) parts.push("saturate(" + sa + "%)");
	return parts.join(" ");
}

/** 该分区实际要用的图片 URL（按 blur 缓存预模糊结果）。 */
function regionImageUrl(regionId, img, blur) {
	var key = regionId + "|" + img.id + "|" + blur;
	var hit = dom.blurCache[key];
	if (hit) {
		dom.lastUrl[regionId] = { id: img.id, url: hit };
		return hit;
	}
	/* null = 正在烤，undefined = 还没开始。两种都先顶上别的东西；
	   注意不能用 `hit !== undefined` 判断，否则烤的过程中会返回 null，
	   拼出 url("null") 让背景整块消失。 */
	if (hit === undefined) {
		dom.blurCache[key] = null;
		blurDataUrl(img.dataUrl, blur, 2560).then(function (out) {
			dom.blurCache[key] = out;
			if (state.cfg.enabled) refreshRegions();
		});
	}
	/* 还没烤好：沿用这个分区上一次真正显示过的图（同一张图的前提下），
	   否则拖模糊滑块时会「清晰 → 模糊」跳一下。 */
	var last = dom.lastUrl[regionId];
	if (last && last.id === img.id) return last.url;
	return img.dataUrl;
}

function ensureGlobalStyle() {
	if (document.getElementById(STYLE_ID)) return;
	var el = document.createElement("style");
	el.id = STYLE_ID;
	el.textContent = GLOBAL_CSS;
	document.head.appendChild(el);
}

function ensureLayer() {
	if (dom.layer && document.body.contains(dom.layer)) return;
	var layer = document.createElement("div");
	layer.id = LAYER_ID;
	var a = document.createElement("div"); a.className = "dsh-wp-img";
	var b = document.createElement("div"); b.className = "dsh-wp-img";
	var scrim = document.createElement("div"); scrim.className = "dsh-wp-scrim";
	layer.appendChild(a); layer.appendChild(b); layer.appendChild(scrim);
	document.body.appendChild(layer);
	dom.layer = layer; dom.imgs = [a, b]; dom.scrim = scrim; dom.showing = 0;
}

function ensureRegionBox() {
	if (dom.regionBox && document.body.contains(dom.regionBox)) return;
	var box = document.createElement("div");
	box.id = REGION_ID;
	REGIONS.forEach(function (def) {
		var el = document.createElement("div");
		el.className = "dsh-wp-region";
		el.setAttribute("data-dsh-region", def.id);
		var scrim = document.createElement("div");
		scrim.className = "dsh-wp-rscrim";
		el.appendChild(scrim);
		box.appendChild(el);
		dom.regionEls[def.id] = { el: el, scrim: scrim };
	});
	document.body.appendChild(box);
	dom.regionBox = box;
}

/**
 * 量出三个界面分区的矩形。
 *
 * DSH 的类名是 CSS Modules 哈希、布局 CSS 还是运行时注入的字符串，没有稳定
 * 选择器可用；但应用外壳是一个横向的整高列布局，所以「找一组占满视口高度、
 * 宽度加起来接近视口宽度的兄弟节点」就能定位三列 —— 覆盖最宽、层级最浅的
 * 那一组即外壳。量不到就返回 null，此时分区层整块不显示（全部用整体背景）。
 */
function measureRegions() {
	try {
		var vw = window.innerWidth || 0;
		var vh = window.innerHeight || 0;
		if (!vw || !vh || vh < 200) return null;
		var root = document.getElementById("root") || document.body;
		if (!root || typeof root.getBoundingClientRect !== "function") return null;

		var best = null;
		(function walk(el, depth) {
			if (!el || depth > 10 || el.nodeType !== 1 || !el.children) return;
			var cols = [];
			for (var i = 0; i < el.children.length; i++) {
				var kid = el.children[i];
				if (!kid || typeof kid.getBoundingClientRect !== "function") continue;
				var r = kid.getBoundingClientRect();
				if (!r || r.width < 24 || r.height < vh * 0.55) continue;
				cols.push({ el: kid, r: r });
			}
			if (cols.length >= 2 && cols.length <= 4) {
				cols.sort(function (a, b) { return a.r.left - b.r.left; });
				var cover = 0;
				for (var j = 0; j < cols.length; j++) cover += cols[j].r.width;
				if (cover >= vw * 0.7) {
					var score = cover * 1000 - depth; /* 先比覆盖宽度，再取更浅的 */
					if (!best || score > best.score) best = { score: score, cols: cols };
				}
			}
			for (var k = 0; k < el.children.length; k++) walk(el.children[k], depth + 1);
		})(root, 0);

		if (!best) return null;
		var cols = best.cols;
		var out = {};
		var narrow = vw * 0.42;
		if (cols.length === 2) {
			var a = cols[0], b = cols[1];
			if (a.r.width <= narrow) { out.sidebar = a.r; out.main = b.r; }
			else if (b.r.width <= narrow) { out.main = a.r; out.aux = b.r; }
			else out.main = a.r.width >= b.r.width ? a.r : b.r;
		} else if (cols.length >= 3) {
			out.sidebar = cols[0].r;
			out.main = cols[Math.floor(cols.length / 2)].r;
			out.aux = cols[cols.length - 1].r;
		}
		return out;
	} catch (err) {
		warn("region measure failed: " + err);
		return null;
	}
}

/** 把量到的矩形写进分区层。返回矩形是否有变化。 */
function layoutRegions(on) {
	ensureRegionBox();
	var rects = on ? measureRegions() : null;
	var key = rectsKey(rects);
	var changed = key !== dom.rectsKey;
	dom.rects = rects;
	dom.rectsKey = key;
	REGIONS.forEach(function (def) {
		var box = dom.regionEls[def.id];
		if (!box) return;
		var cfg = regionCfg(def.id);
		var r = rects ? rects[def.id] : null;
		var img = imageForRegion(cfg);
		if (!(on && cfg.on && r && img && img.dataUrl)) {
			box.el.classList.remove("is-on");
			return;
		}
		var blur = clamp(cfg.blur, 0, 40, 0);
		box.el.style.left = Math.round(r.left) + "px";
		box.el.style.top = Math.round(r.top) + "px";
		box.el.style.width = Math.round(r.width) + "px";
		box.el.style.height = Math.round(r.height) + "px";
		box.el.style.backgroundImage = 'url("' + regionImageUrl(def.id, img, blur) + '")';
		box.el.style.backgroundSize = bgSize(cfg.fit);
		box.el.style.backgroundRepeat = bgRepeat(cfg.fit);
		box.el.style.backgroundPosition = bgPosition(cfg.focus);
		/* 分区层里只有图和一个遮罩，没有文字，所以 filter 直接下没关系（模糊除外，已预烤） */
		box.el.style.filter = filterCss(cfg, false);
		box.el.style.opacity = String(clamp(cfg.imgOpacity, 0, 100, 100) / 100);
		box.scrim.style.opacity = String(clamp(cfg.dim, 0, 90, 0) / 100);
		box.el.classList.add("is-on");
	});
	return changed;
}

/** 分区矩形的指纹，用来判断布局是不是真的变了。 */
function rectsKey(rects) {
	if (!rects) return "";
	var parts = [];
	REGIONS.forEach(function (def) {
		var r = rects[def.id];
		parts.push(r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(",") : "-");
	});
	return parts.join("|");
}

/**
 * 只重算分区层，不动整体壁纸。
 * 聊天界面在流式输出时 DOM 会一直变，如果每次都跑完整 paint()，
 * showImage() 就会反复做交叉淡入 —— 表现就是背景一闪一闪。
 */
function refreshRegions() {
	var any = false;
	for (var i = 0; i < REGIONS.length; i++) if (regionCfg(REGIONS[i].id).on) any = true;
	if (!any) return; /* 没人在用分区，布局变了也不用管 */
	try {
		if (layoutRegions(true)) notify(); /* 矩形变了才刷新设置面板上的识别标记 */
	} catch (err) { warn("region refresh failed: " + err); }
}

/**
 * 读一次「没被我们改过」的令牌值。摘掉 class 再读，否则读到的是我们自己的
 * 半透明结果（自引用）。
 */
function captureTints() {
	var html = document.documentElement;
	var had = html.classList.contains("dsh-wp-on");
	if (had) html.classList.remove("dsh-wp-on");
	var out = {};
	try {
		var cs = getComputedStyle(document.body);
		for (var i = 0; i < SURFACES.length; i++) {
			var v = cs.getPropertyValue(SURFACES[i]).trim();
			if (v) out[SURFACES[i]] = v;
		}
	} catch (err) { warn("tint capture failed: " + err); }
	if (had) html.classList.add("dsh-wp-on");
	return out;
}

function pushTints() {
	var html = document.documentElement;
	for (var i = 0; i < SURFACES.length; i++) {
		var v = dom.tints && dom.tints[SURFACES[i]];
		if (v) html.style.setProperty("--dsh-wp-t" + i, v);
		else html.style.removeProperty("--dsh-wp-t" + i);
	}
}

function applyBg(el, url, cfg) {
	el.style.backgroundImage = "url(" + url + ")";
	el.style.backgroundSize = bgSize(cfg.fit);
	el.style.backgroundRepeat = bgRepeat(cfg.fit);
	el.style.backgroundPosition = bgPosition(cfg.focus);
}

/**
 * 铺整体壁纸。
 *
 * 关键：**同一张图绝不重做交叉淡入**。paint() 会因为配置变化、主题切换、
 * 布局重算被反复调用，如果每次都翻转两层，就会出现「背景闪一下」。
 * 只有图片真的换了才走淡入，而且等新图解码完再切，避免淡入过程中先看到空白。
 */
function showImage(url, cfg, imgId) {
	ensureLayer();
	var cur = dom.imgs[dom.showing];
	if (cur && dom.shownId === imgId) {
		applyBg(cur, url, cfg); /* 只是改了铺法/对齐 */
		return;
	}
	var next = 1 - dom.showing;
	var el = dom.imgs[next];
	applyBg(el, url, cfg);
	var reveal = function () {
		if (dom.imgs[dom.showing] !== el) dom.imgs[dom.showing].classList.remove("is-on");
		el.classList.add("is-on");
		dom.showing = next;
	};
	dom.shownId = imgId;
	try {
		var probe = new Image();
		probe.onload = reveal;
		probe.onerror = reveal;
		probe.src = url;
	} catch (err) { reveal(); }
}

function setFavicon(url) {
	try {
		var link = document.head.querySelector('link[rel~="icon"]');
		if (!link) {
			link = document.createElement("link");
			link.setAttribute("rel", "icon");
			document.head.appendChild(link);
		}
		if (dom.originalFavicon === null) dom.originalFavicon = link.getAttribute("href") || "";
		var target = url || dom.originalFavicon || "";
		if (dom.iconApplied !== target) {
			link.setAttribute("href", target);
			dom.iconApplied = target;
		}
	} catch (err) { warn("favicon: " + err); }
}

function paint(opts) {
	opts = opts || {};
	try {
		ensureGlobalStyle();
		ensureLayer();
		var cfg = state.cfg;
		var img = activeImage();
		var html = document.documentElement;
		var on = !!(cfg.enabled && img && img.dataUrl);

		if (on && (!dom.tints || opts.recapture)) {
			html.classList.remove("dsh-wp-on");
			dom.tints = captureTints();
		}
		pushTints();
		/* 用户设的是「图片不透明度」，面板不透明度正好相反：图越清楚，面板越透。 */
		var veil = 100 - clamp(cfg.imgOpacity, 0, 84, 20);
		html.style.setProperty("--dsh-wp-veil", String(veil) + "%");
		html.classList.toggle("dsh-wp-on", on);

		if (on) showImage(img.dataUrl, cfg, img.id);

		var dim = clamp(cfg.dim, 0, 80, 0);
		dom.scrim.style.opacity = String(dim / 100);

		/* 整体层是全屏的，模糊可以直接下 CSS filter（把盒子往外撑一点避免边缘露白） */
		var blur = clamp(cfg.blur, 0, 24, 0);
		dom.layer.style.filter = filterCss(cfg, true);
		dom.layer.style.inset = blur ? "-" + blur + "px" : "0";

		layoutRegions(on);

		if (cfg.applyIcon && img) {
			var cached = dom.iconCache[img.id];
			if (cached === undefined) {
				dom.iconCache[img.id] = null;
				makeIcon(img.dataUrl).then(function (icon) {
					dom.iconCache[img.id] = icon;
					if (state.cfg.applyIcon && activeImage() && activeImage().id === img.id && icon) setFavicon(icon);
				});
			} else if (cached) setFavicon(cached);
		} else {
			setFavicon(null);
		}
	} catch (err) { warn("paint failed: " + err); }
}

/* --------------------------- behaviour --------------------------- */

var rotTimer = null;
var layoutTimer = null;

/** 布局会随窗口尺寸、侧栏开合变化，节流重量一次；只刷分区层，不碰整体壁纸。 */
function scheduleLayout() {
	if (layoutTimer) return;
	layoutTimer = setTimeout(function () {
		layoutTimer = null;
		if (state.cfg.enabled) refreshRegions();
	}, 400);
}

function scheduleRotation() {
	if (rotTimer) { clearInterval(rotTimer); rotTimer = null; }
	var ms = Number(state.cfg.rotateMs) || 0;
	if (!state.cfg.enabled || ms <= 0 || state.images.length < 2) return;
	rotTimer = setInterval(function () {
		var list = state.images;
		if (list.length < 2) return;
		var idx = -1;
		for (var i = 0; i < list.length; i++) if (list[i].id === state.cfg.activeId) idx = i;
		var nxt;
		if (state.cfg.shuffle) {
			nxt = Math.floor(Math.random() * list.length);
			if (nxt === idx) nxt = (nxt + 1) % list.length;
		} else {
			nxt = (idx + 1) % list.length;
		}
		update({ activeId: list[nxt].id });
	}, Math.max(5000, ms));
}

function update(patch, opts) {
	Object.assign(state.cfg, patch);
	saveConfig();
	paint(opts);
	scheduleRotation();
	notify();
}

function updateRegion(id, patch, opts) {
	Object.assign(regionCfg(id), patch);
	saveConfig();
	paint(opts);
	notify();
}

function addFiles(fileList) {
	var files = Array.prototype.slice.call(fileList || []);
	if (!files.length) return Promise.resolve();
	return openDb().then(function (db) {
		return files.reduce(function (chain, file) {
			return chain.then(function () {
				if (!/^image\//.test(file.type || "")) return null;
				return fileToDataUrl(file)
					.then(function (raw) { return downscale(raw, 2560, 0.86); })
					.then(function (out) {
						var rec = {
							id: "img-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
							name: file.name || "image",
							addedAt: Date.now(),
							dataUrl: out.dataUrl,
							w: out.w, h: out.h
						};
						return dbPut(db, rec).then(function () {
							state.images.push(rec);
							if (!state.cfg.activeId) state.cfg.activeId = rec.id;
						});
					});
			});
		}, Promise.resolve());
	}).then(function () {
		if (!state.cfg.enabled) state.cfg.enabled = true;
		saveConfig();
		paint({ recapture: true });
		scheduleRotation();
		notify();
	}).catch(function (err) { warn("add failed: " + err); });
}

function removeImage(id) {
	openDb().then(function (db) { return dbDel(db, id); }).catch(function () { /* still drop locally */ });
	state.images = state.images.filter(function (r) { return r.id !== id; });
	if (state.cfg.activeId === id) state.cfg.activeId = state.images.length ? state.images[0].id : null;
	REGIONS.forEach(function (def) {
		var c = regionCfg(def.id);
		if (c.imageId === id) { c.imageId = null; c.own = false; }
	});
	if (!state.images.length) state.cfg.enabled = false;
	dom.blurCache = {}; dom.lastUrl = {};
	saveConfig();
	paint({ recapture: true });
	scheduleRotation();
	notify();
}

function clearAll() {
	var ids = state.images.map(function (r) { return r.id; });
	openDb().then(function (db) {
		return ids.reduce(function (chain, id) { return chain.then(function () { return dbDel(db, id); }); }, Promise.resolve());
	}).catch(function () { /* ignore */ });
	state.images = [];
	state.cfg = Object.assign({}, DEFAULTS, { applyIcon: state.cfg.applyIcon, regions: defaultRegions() });
	dom.blurCache = {}; dom.lastUrl = {};
	saveConfig();
	paint({ recapture: true });
	scheduleRotation();
	notify();
}

function loadImages() {
	return openDb().then(dbAll).then(function (rows) {
		state.images = rows.slice().sort(function (a, b) { return (a.addedAt || 0) - (b.addedAt || 0); });
		if (state.images.length) {
			var known = state.images.some(function (r) { return r.id === state.cfg.activeId; });
			if (!known) { state.cfg.activeId = state.images[0].id; saveConfig(); }
		}
		paint({ recapture: true });
		scheduleRotation();
		notify();
		log("loaded " + state.images.length + " image(s)");
	}).catch(function (err) { warn("image store unavailable: " + err); });
}

/* ---------------------------- locale ----------------------------- */

var zh = {
	nav: "dsh-backdrop（背景）",
	intro: "把你自己的图片铺到界面后面：整体一张壁纸，左侧边栏 / 主内容区 / 右侧边栏还可以各用一张。图片只存在这个浏览器里，不上传任何地方。",
	drop: "点击选择图片，或把图片拖进来（可多选）",
	gallery: "图片库",
	empty: "还没有图片。先加一张吧。",
	enable: "启用壁纸",
	overall: "整体背景",
	image: "图片",
	imgOpacity: "图片不透明度",
	fit: "显示方式",
	fitFill: "填充",
	fitFit: "适应",
	fitStretch: "拉伸",
	fitTile: "平铺",
	fitCenter: "居中",
	focus: "对齐位置",
	blur: "模糊",
	dim: "变暗",
	brightness: "亮度",
	contrast: "对比度",
	saturate: "饱和度",
	moreEffects: "更多效果（亮度 / 对比度 / 饱和度）",
	followOverall: "跟随整体背景",
	rotate: "轮播",
	rotOff: "不轮播",
	rot30: "30 秒",
	rot5m: "5 分钟",
	rot30m: "30 分钟",
	rot1h: "1 小时",
	shuffle: "随机顺序",
	applyIcon: "用当前图片当界面图标",
	clear: "清空图片库",
	live: "改动即时生效，刷新后保留。",
	configNote: "配置存在 profile patch 里本插件那一行的 config: 下（id: dsh-backdrop），可以直接编辑。",

	regionsTitle: "分区背景",
	regionsIntro: "整体背景之外，三个界面分区可以各用一张图；没开启的分区就透出整体背景。",
	regionOn: "这个分区单独设图",
	regionDetected: "已识别",
	regionMissing: "未识别到该分区"
};

var en = {
	nav: "dsh-backdrop (background)",
	intro: "Put your own images behind the UI: one overall wallpaper, plus an optional image per section (left sidebar / main / right sidebar). Images stay in this browser only — nothing is uploaded.",
	drop: "Click to choose images, or drop them here (multiple allowed)",
	gallery: "Library",
	empty: "No images yet — add one to begin.",
	enable: "Enable wallpaper",
	overall: "Overall background",
	image: "Image",
	imgOpacity: "Image opacity",
	fit: "Display mode",
	fitFill: "Fill",
	fitFit: "Fit",
	fitStretch: "Stretch",
	fitTile: "Tile",
	fitCenter: "Center",
	focus: "Alignment",
	blur: "Blur",
	dim: "Darken",
	brightness: "Brightness",
	contrast: "Contrast",
	saturate: "Saturation",
	moreEffects: "More effects (brightness / contrast / saturation)",
	followOverall: "Follow overall",
	rotate: "Carousel",
	rotOff: "Off",
	rot30: "30 seconds",
	rot5m: "5 minutes",
	rot30m: "30 minutes",
	rot1h: "1 hour",
	shuffle: "Random order",
	applyIcon: "Use current image as the app icon",
	clear: "Clear library",
	live: "Changes apply instantly and survive a refresh.",
	configNote: "Settings live under this plugin's own row (id: dsh-backdrop) in the profile patch, and can be edited there directly.",

	regionsTitle: "Section backgrounds",
	regionsIntro: "Beyond the overall background, each of the three UI sections can use its own image; a section that is off simply shows the overall background.",
	regionOn: "Give this section its own image",
	regionDetected: "detected",
	regionMissing: "section not detected"
};

/* --------------- 分区的显示名与「这个区域是什么」提示 --------------- */
var REGION_TEXT = {
	zh: {
		sidebar: { name: "左侧边栏", hint: "左边那一条：新对话、工作区、会话列表。" },
		main:    { name: "主内容区", hint: "中间主体：会话转录区与底部输入框。" },
		aux:     { name: "右侧边栏", hint: "右边那一条：文件树、文档预览等侧栏面板。" }
	},
	en: {
		sidebar: { name: "Left sidebar", hint: "The left rail: new chat, workspaces, session list." },
		main:    { name: "Main area", hint: "The centre: conversation transcript and the composer." },
		aux:     { name: "Right sidebar", hint: "The right rail: file tree, document preview and other side panels." }
	}
};

function regionText(id, lang) {
	var table = REGION_TEXT[lang] || REGION_TEXT.en;
	return table[id] || { name: id, hint: "" };
}

/* -------------------------- settings UI -------------------------- */

function Slider(props) {
	return h("label", { className: "dshwp-row" },
		h("span", null, props.label),
		h("input", {
			type: "range",
			min: props.min, max: props.max, step: props.step || 1,
			value: props.value,
			onChange: function (e) { props.onChange(Number(e.target.value)); }
		}),
		h("span", { className: "dshwp-val" }, String(props.value) + (props.suffix || ""))
	);
}

function Selector(props) {
	return h("label", { className: "dshwp-row" },
		h("span", null, props.label),
		h("select", {
			value: props.value,
			style: { flex: 1, minWidth: 0, font: "inherit", fontSize: 12.5, padding: "3px 6px" },
			onChange: function (e) { props.onChange(e.target.value); }
		}, props.options.map(function (o) { return h("option", { key: o.value, value: o.value }, o.label); }))
	);
}

function Check(props) {
	return h("label", { className: "dshwp-check" },
		h("input", { type: "checkbox", checked: !!props.checked, onChange: function (e) { props.onChange(e.target.checked); } }),
		h("span", null, props.label)
	);
}

/** 显示方式的选项：沿用 Windows 壁纸那套词。 */
function fitOptions(t) {
	return [
		{ value: "fill", label: t("fitFill") },
		{ value: "fit", label: t("fitFit") },
		{ value: "stretch", label: t("fitStretch") },
		{ value: "tile", label: t("fitTile") },
		{ value: "center", label: t("fitCenter") }
	];
}

/** 九宫格对齐选择器。 */
var FOCUS_ORDER = ["top left", "top", "top right", "left", "center", "right", "bottom left", "bottom", "bottom right"];

function Align9(props) {
	return h("div", { className: "dshwp-row" },
		h("span", null, props.label),
		h("div", { className: "dshwp-align" }, FOCUS_ORDER.map(function (v) {
			return h("button", {
				key: v, type: "button", title: v,
				className: props.value === v ? "is-on" : "",
				onClick: function () { props.onChange(v); }
			});
		}))
	);
}

/**
 * 「更多效果」折叠区：亮度 / 对比度 / 饱和度。
 * 这三个是图片编辑里最通用的一组，默认不动（100%）就不写入 filter。
 */
function MoreEffects(props) {
	var t = props.t, cfg = props.cfg, on = props.onChange;
	var pair = React.useState(false);
	var open = pair[0], setOpen = pair[1];
	var dirty = Number(cfg.brightness) !== 100 || Number(cfg.contrast) !== 100 || Number(cfg.saturate) !== 100;
	return h("div", null,
		h("div", { className: "dshwp-morehead", onClick: function () { setOpen(!open); } },
			(open ? "▾ " : "▸ ") + t("moreEffects") + (dirty ? " ·" : "")),
		!open ? null : h("div", { style: { display: "flex", flexDirection: "column", gap: 9, marginTop: 9 } },
			h(Slider, { label: t("brightness"), min: 20, max: 200, value: cfg.brightness, suffix: "%", onChange: function (v) { on({ brightness: v }); } }),
			h(Slider, { label: t("contrast"), min: 20, max: 200, value: cfg.contrast, suffix: "%", onChange: function (v) { on({ contrast: v }); } }),
			h(Slider, { label: t("saturate"), min: 0, max: 200, value: cfg.saturate, suffix: "%", onChange: function (v) { on({ saturate: v }); } })
		)
	);
}

/** 一个分区的配置卡片。 */
function RegionCard(props) {
	var t = props.t, lang = props.lang, def = props.def;
	var cfg = regionCfg(def.id);
	var text = regionText(def.id, lang);
	var rect = dom.rects ? dom.rects[def.id] : null;
	var images = state.images;
	var active = activeImage();

	var tag = !cfg.on ? null : (rect
		? h("span", { className: "dshwp-tag is-on" }, t("regionDetected") + " " + Math.round(rect.width) + "×" + Math.round(rect.height))
		: h("span", { className: "dshwp-tag" }, t("regionMissing")));

	return h("div", { className: "dshwp-card" },
		h("div", { className: "dshwp-cardtitle" }, h("span", null, text.name), tag),
		h("div", { className: "dshwp-sub" }, text.hint),
		h(Check, {
			label: t("regionOn"), checked: !!cfg.on,
			onChange: function (v) { updateRegion(def.id, { on: v }); }
		}),
		!cfg.on ? null : h("div", { style: { display: "flex", flexDirection: "column", gap: 9 } },
			h(Selector, {
				label: t("image"), value: cfg.own ? (cfg.imageId || "") : "",
				options: [{ value: "", label: t("followOverall") }].concat(images.map(function (im) {
					return { value: im.id, label: im.name };
				})),
				onChange: function (v) { updateRegion(def.id, { own: !!v, imageId: v || null }); }
			}),
			h(Slider, {
				label: t("imgOpacity"), min: 0, max: 100, value: cfg.imgOpacity, suffix: "%",
				onChange: function (v) { updateRegion(def.id, { imgOpacity: v }); }
			}),
			h(Selector, {
				label: t("fit"), value: cfg.fit, options: fitOptions(t),
				onChange: function (v) { updateRegion(def.id, { fit: v }); }
			}),
			h(Align9, {
				label: t("focus"), value: cfg.focus,
				onChange: function (v) { updateRegion(def.id, { focus: v }); }
			}),
			h(Slider, {
				label: t("blur"), min: 0, max: 40, value: cfg.blur, suffix: "px",
				onChange: function (v) { updateRegion(def.id, { blur: v }); }
			}),
			h(Slider, {
				label: t("dim"), min: 0, max: 90, value: cfg.dim, suffix: "%",
				onChange: function (v) { updateRegion(def.id, { dim: v }); }
			}),
			h(MoreEffects, { t: t, cfg: cfg, onChange: function (p) { updateRegion(def.id, p); } })
		)
	);
}

function Section(props) {
	var t = props && typeof props.t === "function" ? props.t : function (k) { return k; };
	var lang = props && props.lang === "en" ? "en" : "zh";
	var pair = React.useState(0);
	var force = pair[1];
	React.useEffect(function () {
		var fn = function () { force(function (n) { return n + 1; }); };
		subs.add(fn);
		return function () { subs.delete(fn); };
	}, []);

	var cfg = state.cfg;
	var images = state.images;
	var active = activeImage();

	var onPick = function (e) {
		addFiles(e.target.files);
		e.target.value = "";
	};
	var onDrop = function (e) {
		e.preventDefault();
		if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
	};

	return h("div", { className: "dshwp-wrap" },
		h("style", null, PANEL_CSS),
		h("div", { className: "dshwp-intro" }, t("intro")),

		h("label", { className: "dshwp-drop", onDragOver: function (e) { e.preventDefault(); }, onDrop: onDrop },
			h("input", {
				type: "file", accept: "image/*", multiple: true,
				style: { display: "none" }, onChange: onPick
			}),
			h("div", null, t("drop"))
		),

		h("div", { className: "dshwp-actions" },
			h("button", {
				type: "button", className: "dshwp-btn",
				disabled: !images.length,
				onClick: function () { clearAll(); }
			}, t("clear"))
		),

		h("div", { className: "dshwp-card" },
			h("div", { className: "dshwp-row" }, h("span", null, t("gallery"))),
			images.length === 0
				? h("div", { className: "dshwp-empty" }, t("empty"))
				: h("div", { className: "dshwp-grid" }, images.map(function (img) {
					return h("button", {
						key: img.id,
						type: "button",
						className: "dshwp-thumb" + (active && active.id === img.id ? " is-active" : ""),
						title: img.name,
						onClick: function () { update({ activeId: img.id, enabled: true }, { recapture: true }); }
					},
						h("img", { src: img.dataUrl, alt: img.name }),
						h("span", {
							className: "dshwp-x",
							onClick: function (e) { e.stopPropagation(); removeImage(img.id); }
						}, "×")
					);
				}))
		),

		/* ── 整体背景 ── */
		h("div", { className: "dshwp-card" },
			h("div", { className: "dshwp-cardtitle" }, h("span", null, t("overall"))),
			h(Check, {
				label: t("enable"), checked: !!cfg.enabled,
				onChange: function (v) { update({ enabled: v }, { recapture: true }); }
			}),
			h(Slider, { label: t("imgOpacity"), min: 0, max: 84, value: cfg.imgOpacity, suffix: "%", onChange: function (v) { update({ imgOpacity: v }, { recapture: true }); } }),
			h(Selector, {
				label: t("fit"), value: cfg.fit, options: fitOptions(t),
				onChange: function (v) { update({ fit: v }); }
			}),
			h(Align9, {
				label: t("focus"), value: cfg.focus,
				onChange: function (v) { update({ focus: v }); }
			}),
			h(Slider, { label: t("blur"), min: 0, max: 24, value: cfg.blur, suffix: "px", onChange: function (v) { update({ blur: v }); } }),
			h(Slider, { label: t("dim"), min: 0, max: 80, value: cfg.dim, suffix: "%", onChange: function (v) { update({ dim: v }); } }),
			h(MoreEffects, { t: t, cfg: cfg, onChange: function (p) { update(p); } }),
			h(Selector, {
				label: t("rotate"), value: String(cfg.rotateMs),
				options: [
					{ value: "0", label: t("rotOff") },
					{ value: "30000", label: t("rot30") },
					{ value: "300000", label: t("rot5m") },
					{ value: "1800000", label: t("rot30m") },
					{ value: "3600000", label: t("rot1h") }
				],
				onChange: function (v) { update({ rotateMs: Number(v) }); }
			}),
			h(Check, { label: t("shuffle"), checked: !!cfg.shuffle, onChange: function (v) { update({ shuffle: v }); } }),
			h(Check, { label: t("applyIcon"), checked: !!cfg.applyIcon, onChange: function (v) { update({ applyIcon: v }); } })
		),

		/* ── 分区背景 ── */
		h("div", { className: "dshwp-sub" }, t("regionsTitle") + " — " + t("regionsIntro")),
		REGIONS.map(function (def) {
			return h(RegionCard, { key: def.id, def: def, t: t, lang: lang });
		}),

		h("div", { className: "dshwp-intro" }, t("live")),
		h("div", { className: "dshwp-sub" }, t("configNote"))
	);
}

/* ---------------------------- plugin ----------------------------- */

var name = NAME;
var inject = ["slots", "locale"];

function apply(ctx) {
	loadConfig();
	try { ensureGlobalStyle(); } catch (err) { warn("global style skipped: " + err); }

	var lang = "zh";
	var tr = function (k) { return k; };
	try {
		if (ctx.locale && typeof ctx.locale.register === "function") {
			ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, NAME + ": settings copy");
			tr = ctx.locale.bind(NS);
			try {
				var cur = ctx.locale.current && ctx.locale.current();
				if (cur && String(cur).toLowerCase().indexOf("zh") !== 0) lang = "en";
			} catch (err) { /* 语言探测失败就按中文 */ }
		}
	} catch (err) { warn("locale unavailable: " + err); }

	ctx.effect(function () {
		paint({ recapture: true });
		var onResize = function () { scheduleLayout(); };
		try { window.addEventListener("resize", onResize); } catch (err) { /* ignore */ }
		var mo = null;
		try {
			if (typeof MutationObserver !== "undefined") {
				mo = new MutationObserver(function () { if (state.cfg.enabled) scheduleLayout(); });
				mo.observe(document.body, { childList: true, subtree: true });
			}
		} catch (err) { /* 观察不到就只靠 resize */ }
		return function () {
			if (rotTimer) { clearInterval(rotTimer); rotTimer = null; }
			if (layoutTimer) { clearTimeout(layoutTimer); layoutTimer = null; }
			try { window.removeEventListener("resize", onResize); } catch (err) { /* ignore */ }
			if (mo) { try { mo.disconnect(); } catch (err) { /* ignore */ } }
			try { setFavicon(null); } catch (err) { /* ignore */ }
			if (dom.layer && dom.layer.parentNode) dom.layer.parentNode.removeChild(dom.layer);
			if (dom.regionBox && dom.regionBox.parentNode) dom.regionBox.parentNode.removeChild(dom.regionBox);
			var style = document.getElementById(STYLE_ID);
			if (style && style.parentNode) style.parentNode.removeChild(style);
			document.documentElement.classList.remove("dsh-wp-on");
			dom.layer = null; dom.imgs = null; dom.scrim = null; dom.shownId = null;
			dom.regionBox = null; dom.regionEls = {}; dom.tints = null;
			dom.rects = null; dom.rectsKey = "";
		};
	}, NAME + ": wallpaper layer");

	try {
		ctx.on("theme/change", function () { setTimeout(function () { paint({ recapture: true }); }, 0); });
	} catch (err) { warn("theme listener unavailable: " + err); }

	loadImages();
	fetchConfig();

	try {
		ctx.slots.inject("settings.section", function () {
			return ctx.slots.register({
				name: "settings.section",
				id: NAME,
				order: 45,
				label: function () { return tr("nav"); },
				locale: NS
			}, function (p) { return Section(Object.assign({}, p, { lang: lang })); });
		});
	} catch (err) { warn("settings slot unavailable: " + err); }

	log("ready");
}

exports.name = name;
exports.inject = inject;
exports.apply = apply;
return module.exports; } });
