/**
 * 冒烟测试：在 Node 里用桩件加载 lib/client.js，跑一遍 apply() 并渲染设置面板。
 *
 * 目的不是替代真实浏览器，而是抓住「bundle 形状不对 / 引用错变量 / 渲染路径抛错 /
 * 分层令牌算错」这类一装上去就把设置页弄崩的问题。
 *
 *     node plugins/dsh-backdrop/tools/smoke-client.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FILE = path.join(__dirname, "..", "lib", "client.js");
const code = fs.readFileSync(FILE, "utf8");

const problems = [];
const note = (m) => console.log("  " + m);
const check = (cond, msg) => { if (cond) note("ok   " + msg); else problems.push(msg); };

/* ---------------------------- DOM 桩 ---------------------------- */

function makeEl(tag) {
	const el = {
		tagName: tag,
		nodeType: 1,
		id: "",
		className: "",
		textContent: "",
		style: {
			_props: {},
			setProperty(k, v) { this._props[k] = v; },
			removeProperty(k) { delete this._props[k]; },
			getPropertyValue(k) { return this._props[k] || ""; }
		},
		children: [],
		parentNode: null,
		classList: {
			_states: new Set(),
			add(c) { this._states.add(c); },
			remove(c) { this._states.delete(c); },
			toggle(c, on) { if (on === undefined) { this._states.has(c) ? this._states.delete(c) : this._states.add(c); } else if (on) this._states.add(c); else this._states.delete(c); },
			contains(c) { return this._states.has(c); }
		},
		appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
		removeChild(c) { el.children = el.children.filter((x) => x !== c); return c; },
		setAttribute(k, v) { el[k] = v; },
		getAttribute(k) { return el[k] === undefined ? null : el[k]; },
		removeAttribute(k) { delete el[k]; },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		contains(c) { return c === el || el.children.includes(c); },
		addEventListener() {},
		removeEventListener() {}
	};
	return el;
}

const head = makeEl("head");
const body = makeEl("body");

/** getElementById 要能找回我们插进去的 <style>，否则每次 paint 都会新建一个。 */
const byId = new Map();
const documentStub = {
	head,
	body,
	documentElement: makeEl("html"),
	getElementById(id) { return byId.get(id) || null; },
	createElement(tag) {
		const el = makeEl(tag);
		// 记录 id 赋值，方便 getElementById 找回
		Object.defineProperty(el, "id", {
			get() { return el._id || ""; },
			set(v) { el._id = v; byId.set(v, el); },
			configurable: true
		});
		return el;
	},
	querySelector() { return null; },
	addEventListener() {},
	removeEventListener() {}
};

/* ------------------------ 假的三列布局 ------------------------ */
/* measureRegions() 靠「整高、宽度加起来接近视口的兄弟节点」认外壳，所以这里
   搭一个 #root > frame > [侧栏 260 | 主区 1000 | 右栏 300]，视口 1560×900。 */

const VW = 1560;
const VH = 900;

function layoutEl(left, width) {
	const el = documentStub.createElement("div");
	el._rect = { left, top: 0, width, height: VH };
	el.getBoundingClientRect = () => el._rect;
	return el;
}

const rootEl = documentStub.createElement("div");
rootEl.id = "root";
rootEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: VW, height: VH });
const frameEl = documentStub.createElement("div");
frameEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: VW, height: VH });
const colSidebar = layoutEl(0, 260);
const colMain = layoutEl(260, 1000);
const colAux = layoutEl(1260, 300);
frameEl.appendChild(colSidebar);
frameEl.appendChild(colMain);
frameEl.appendChild(colAux);
rootEl.appendChild(frameEl);

/* --------------------------- React 桩 --------------------------- */

const created = [];

function createElement(type, props, ...children) {
	const el = { type, props: props || {}, children: children.flat() };
	created.push(el);
	return el;
}

const reactStub = {
	createElement,
	default: null,
	useState(init) { return [typeof init === "function" ? init() : init, () => {}]; },
	useEffect(fn) { const cleanup = fn(); if (typeof cleanup === "function") cleanup(); },
	useRef(v) { return { current: v === undefined ? null : v }; },
	useMemo(fn) { return fn(); },
	useCallback(fn) { return fn; }
};
reactStub.default = reactStub;

/* ------------------------ IndexedDB 桩 ------------------------ */
/* 让 loadImages() 能真的取到一条记录，从而走完 paint() 的令牌分支。 */

const IMG_ID = "img-smoke-1";
const IMG_DATA = "data:image/jpeg;base64,AAAA";

function makeRequest(getResult) {
	const req = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
	queueMicrotask(() => {
		try {
			req.result = getResult();
			if (req.onsuccess) req.onsuccess();
		} catch (e) {
			req.error = e;
			if (req.onerror) req.onerror();
		}
	});
	return req;
}

const fakeIndexedDB = {
	open() {
		const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
		queueMicrotask(() => {
			req.result = {
				objectStoreNames: { contains: () => true },
				transaction() {
					const tx = { oncomplete: null, onerror: null, error: null };
					tx.objectStore = () => ({
						getAll: () => makeRequest(() => [{ id: IMG_ID, name: "smoke.jpg", addedAt: 1, dataUrl: IMG_DATA, w: 10, h: 10 }]),
						put: () => makeRequest(() => undefined),
						delete: () => makeRequest(() => undefined)
					});
					queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
					return tx;
				}
			};
			if (req.onupgradeneeded) req.onupgradeneeded();
			if (req.onsuccess) req.onsuccess();
		});
		return req;
	}
};

/* --------------------------- 运行 bundle -------------------------- */

let captured = null;
const STORE = {};
const sandbox = {
	console,
	document: documentStub,
	setTimeout, clearTimeout,
	setInterval: () => 0,
	clearInterval() {},
	Promise,
	queueMicrotask,
	URLSearchParams,
	location: { hash: "", pathname: "/", search: "" },
	history: { replaceState() {}, state: null },
	addEventListener() {},
	removeEventListener() {},
	localStorage: {
		getItem(k) { return STORE[k] === undefined ? null : STORE[k]; },
		setItem(k, v) { STORE[k] = String(v); },
		removeItem(k) { delete STORE[k]; }
	},
	getComputedStyle() {
		return {
			getPropertyValue(name) {
				/* 模拟 0.1.5：没有 bg-layer-4 这一层 */
				if (name === "--dsw-alias-bg-layer-4") return "";
				return "#ffffff";
			},
			backgroundColor: "rgb(255,255,255)"
		};
	},
	fetch: () => Promise.reject(new Error("no network in smoke test")),
	Image: undefined,
	FileReader: undefined,
	indexedDB: fakeIndexedDB,
	navigator: { userAgent: "smoke" },
	innerWidth: VW,
	innerHeight: VH
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.window.__ModuleLoader__ = { load(def) { captured = def; } };

const context = vm.createContext(sandbox);
try {
	vm.runInContext(code, context, { filename: FILE });
} catch (err) {
	console.error("FAIL: bundle 顶层执行抛错 ->", err.message);
	process.exit(1);
}

if (!captured) { console.error("FAIL: 没有调用 window.__ModuleLoader__.load"); process.exit(1); }
note(`bundle id: ${captured.id}`);
check(captured.id === "dsh-backdrop", `bundle id 应为 dsh-backdrop，实际 ${captured.id}`);

const fakeRequire = (id) => {
	if (id === "react") return reactStub;
	if (id === "react/jsx-runtime") return { jsx: createElement, jsxs: createElement };
	throw new Error("unexpected require: " + id);
};

let mod;
try {
	mod = captured.factory(fakeRequire);
} catch (err) {
	console.error("FAIL: factory 执行抛错 ->", err.message);
	process.exit(1);
}

note(`exports.name   = ${mod.name}`);
note(`exports.inject = ${JSON.stringify(mod.inject)}`);
check(typeof mod.apply === "function", "缺少 apply 导出");
check(mod.name === "dsh-backdrop", `name 应为 dsh-backdrop，实际 ${mod.name}`);
check(Array.isArray(mod.inject) && mod.inject.includes("slots"), "inject 应包含 slots");

/* ---------------------------- apply() ---------------------------- */

const registered = [];
const handlers = {};
const ctx = {
	effect(fn, label) {
		try { return fn(); } catch (err) { problems.push(`effect(${label}) 抛错: ${err.message}`); }
	},
	on(name, fn) { handlers[name] = fn; },
	locale: {
		register(ns, dict) {
			note(`locale.register(${ns}) zh=${Object.keys(dict.zh || {}).length} keys en=${Object.keys(dict.en || {}).length} keys`);
			return () => {};
		},
		bind() { return (k) => k; },
		current() { return "zh-CN"; }
	},
	slots: {
		inject(name, cb) { note(`slots.inject(${name})`); cb(); },
		register(opts, Component) { registered.push({ opts, Component }); return () => {}; }
	}
};

/* 先塞一份旧版配置（顶层字段 + 只有一个分区的 regions），验证迁移不炸；
   同时打开侧边栏分区，好断言矩形与背景真的写进去了。 */
STORE["dsh-backdrop:config"] = JSON.stringify({
	enabled: true, activeId: IMG_ID, veil: 80, dim: 10, fit: "cover", focus: "center",
	blur: 0, rotateMs: 0, shuffle: false, applyIcon: false,
	regions: {
		sidebar: { on: true, own: false, opacity: 60, fit: "cover", focus: "center", blur: 0, dim: 10 },
		aux: { on: false }
	}
});

try {
	mod.apply(ctx);
	note("apply() 完成");
} catch (err) {
	console.error("FAIL: apply() 抛错 ->", err.stack);
	process.exit(1);
}

check(registered.length > 0, "没有注册 settings.section");
for (const r of registered) {
	note(`registered slot: ${r.opts.name} id=${r.opts.id} order=${r.opts.order} locale=${r.opts.locale}`);
	check(r.opts.name === "settings.section", `slot 名应为 settings.section，实际 ${r.opts.name}`);
	check(r.opts.locale === "settings.dsh-backdrop", `locale 命名空间不对: ${r.opts.locale}`);
}

/* -------------------- 等 loadImages() 走完再断言 -------------------- */

setTimeout(() => {
	/* 1) 设置面板能渲染 */
	for (const r of registered) {
		try {
			const tree = r.Component({ t: (k) => k });
			check(!!tree, "Section 返回空");
			note(`Section 渲染 OK（${created.length} 个元素）`);
		} catch (err) {
			problems.push(`Section 渲染抛错: ${err.message}`);
		}
	}

	/* 2) 分区层建好了，矩形与背景都写对了 */
	const box = byId.get("dsh-wp-regions");
	if (!box) {
		problems.push("没有注入 #dsh-wp-regions");
	} else {
		check(box.children.length === 3, `分区容器应有 3 个子节点，实际 ${box.children.length}`);
		const byRegion = {};
		for (const c of box.children) byRegion[c.getAttribute("data-dsh-region")] = c;
		check(!!byRegion.sidebar && !!byRegion.main && !!byRegion.aux, "三个分区标记应为 sidebar / main / aux");

		const sb = byRegion.sidebar;
		if (!sb) {
			problems.push("找不到 sidebar 分区节点");
		} else {
			check(sb.classList.contains("is-on"), "开了独立背景的侧边栏分区应显示");
			check(sb.style.left === "0px" && sb.style.top === "0px", `侧边栏矩形位置应为 0/0，实际 ${sb.style.left}/${sb.style.top}`);
			check(sb.style.width === "260px" && sb.style.height === "900px", `侧边栏矩形应为 260×900，实际 ${sb.style.width}×${sb.style.height}`);
			check(String(sb.style.backgroundImage).includes("data:image/jpeg;base64,AAAA"), "侧边栏分区应带上分区图片");
			check(sb.style.backgroundSize === "cover", `铺法应为 cover，实际 ${sb.style.backgroundSize}`);
			check(sb.style.backgroundRepeat === "no-repeat", `非平铺时应为 no-repeat，实际 ${sb.style.backgroundRepeat}`);
			check(sb.style.opacity === "0.6", `与整体混合应为 0.6，实际 ${sb.style.opacity}`);
			note(`sidebar 分区 = ${sb.style.left},${sb.style.top} ${sb.style.width}×${sb.style.height} opacity=${sb.style.opacity}`);
		}
		check(byRegion.main && !byRegion.main.classList.contains("is-on"), "没开的分区（主内容区）不应显示");
		check(byRegion.aux && !byRegion.aux.classList.contains("is-on"), "没开的分区（右侧边栏）不应显示");
	}

	/* 3) 面板透明令牌与全局样式 */
	const html = documentStub.documentElement;
	check(html.classList.contains("dsh-wp-on"), "启用后 html 应带上 dsh-wp-on");
	check(html.style._props["--dsh-wp-t0"] === "#ffffff", "面板令牌原色应被抓到（--dsh-wp-t0）");
	check(html.style._props["--dsh-wp-veil"] === "80%", `面板不透明度应为 80%，实际 ${html.style._props["--dsh-wp-veil"]}`);
	const styleEl = byId.get("dsh-wp-global-style");
	check(!!styleEl && styleEl.textContent.includes("color-mix(in srgb,var(--dsh-wp-t0"), "全局样式应包含 color-mix 令牌重绑");
	check(!!styleEl && styleEl.textContent.includes("#dsh-wp-regions"), "全局样式应包含分区层规则");

	/* 4) 分区配置卡片能渲染（Section 里只是 createElement，没真正调用组件） */
	try {
		const regionCard = created.find((e) => e.type && e.type.name === "RegionCard");
		if (!regionCard) note("（RegionCard 由 Section 通过 createElement 引用，桩件不调用函数组件，属预期）");
	} catch (err) { /* ignore */ }

	/* 4) 结果 */
	if (problems.length) {
		console.error("\nFAIL:");
		for (const p of problems) console.error("  - " + p);
		process.exit(1);
	}
	console.log("\nPASS: bundle 形状、apply()、设置面板渲染与分层令牌都正常。");
}, 30);
