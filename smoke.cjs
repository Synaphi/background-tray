// Load the bundled main.js in a stub environment and exercise the core paths (no Electron runtime).
const Module = require("module");
const origLoad = Module._load;

// ── obsidian stub ──
class Plugin {
  constructor(app, manifest){ this.app=app; this.manifest=manifest; this._commands=[]; this._tabs=[]; this._data={}; }
  addCommand(c){ this._commands.push(c); return c; }
  addSettingTab(t){ this._tabs.push(t); }
  async loadData(){ return this._data; }
  async saveData(d){ this._data=d; }
}
class PluginSettingTab { constructor(app,plugin){ this.app=app; this.plugin=plugin; this.containerEl={empty(){},}; } }
class Setting { constructor(){} setName(){return this;} setDesc(){return this;} addToggle(cb){cb({setValue(){return this;},onChange(){return this;}});return this;} addText(cb){cb({setPlaceholder(){return this;},setValue(){return this;},onChange(){return this;}});return this;} }
let notices=[]; class Notice { constructor(m){ notices.push(m); } }
const obsidianStub = { Plugin, PluginSettingTab, Setting, Notice, App: class {} };

// ── @electron/remote stub ──
const log = { listeners:{}, hidden:0, shown:0, focused:0, trayCreated:0, trayDestroyed:0, prevented:0, quit:0 };
const fakeWin = {
  _visible:true, _min:false,
  on(ev,fn){ (log.listeners[ev]=log.listeners[ev]||[]).push(fn); },
  removeListener(ev,fn){ log.listeners[ev]=(log.listeners[ev]||[]).filter(f=>f!==fn); },
  hide(){ this._visible=false; log.hidden++; },
  show(){ this._visible=true; log.shown++; },
  focus(){ log.focused++; },
  isVisible(){ return this._visible; }, isMinimized(){ return this._min; }, restore(){ this._min=false; },
  close(){ log.quit++; }, setSkipTaskbar(){}, isDestroyed(){ return false; }, id:1,
};
class Tray { constructor(i){ this.icon=i; log.trayCreated++; } setToolTip(t){ log.tooltip=t; } setContextMenu(){} on(){} destroy(){ log.trayDestroyed++; } }
const Menu = { buildFromTemplate(t){ log.menuTemplate=t; return {_t:t}; } };
const nativeImage = { createFromPath(){ return {isEmpty(){return true;}}; }, createFromDataURL(){ return {isEmpty(){return false;}}; }, createEmpty(){ return {}; } };
// Registry of app (main-process) events — used to exercise the single-instance relaunch path.
const appEvents = {};
const remoteStub = { getCurrentWindow(){ return fakeWin; }, Tray, Menu, nativeImage, app:{
  quit(){log.quit++;}, relaunch(){}, exit(){}, dock:{show(){}},
  async getFileIcon(){ return {isEmpty(){return true;}}; },
  prependListener(ev,fn){ (appEvents[ev]=appEvents[ev]||[]).unshift(fn); },
  on(ev,fn){ (appEvents[ev]=appEvents[ev]||[]).push(fn); },
  removeListener(ev,fn){ appEvents[ev]=(appEvents[ev]||[]).filter(f=>f!==fn); },
  _emit(ev,...args){ (appEvents[ev]||[]).slice().forEach(fn=>fn(...args)); },
} };

Module._load = function(req, parent, isMain){
  if (req === "obsidian") return obsidianStub;
  if (req === "@electron/remote") return remoteStub;
  if (req === "electron") return { remote: remoteStub };
  return origLoad.apply(this, arguments);
};

// ── global window stub ── mimics the renderer window.require / beforeunload / setTimeout.
const _winListeners = {};
global.window = {
  require,
  addEventListener(ev, fn){ (_winListeners[ev]=_winListeners[ev]||[]).push(fn); },
  removeEventListener(ev, fn){ _winListeners[ev]=(_winListeners[ev]||[]).filter(f=>f!==fn); },
  setTimeout: (fn, t) => setTimeout(fn, t),
};

global.document = { title: "Some note - TitleVault - Obsidian v1.12.0" };

const PluginClass = require("./main.js").default || require("./main.js");
const mkApp = (vault) => ({ vault, workspace:{ onLayoutReady(cb){ cb(); } } });
const app = mkApp({ getName(){ return "TestVault"; }, adapter:{ getBasePath(){ return "C:\\Obsidian\\TestVault"; } } });
const p = new PluginClass(app, { id:"background-tray" });

(async () => {
  let fail=0; const ok=(c,m)=>{ console.log((c?"  PASS":"  FAIL")+" — "+m); if(!c)fail++; };
  await p.onload();
  ok(log.trayCreated===1, "creates exactly one tray");
  ok((log.listeners["close"]||[]).length===1, "registers exactly one close listener");
  ok(p._commands.length===3, "registers 3 commands (show/hide/toggle)");
  ok(p._commands.map(c=>c.id).sort().join(",")==="hide-window,show-window,toggle-window", "command ids = show/hide/toggle-window");
  // Simulate closing: runInBackground defaults to ON → preventDefault + hide
  let prevented=false; const ev={preventDefault(){prevented=true;}};
  (log.listeners["close"]||[]).forEach(fn=>fn(ev));
  ok(prevented===true, "close interception: calls preventDefault");
  ok(log.hidden===1, "hides the window on close");
  // toggle: currently hidden → show+focus
  p.toggleWindow();
  ok(log.shown===1 && log.focused===1, "toggleWindow brings the window back");
  // ── default tray tooltip ──
  ok(log.tooltip==="TestVault — Obsidian", "tray tooltip = '<vault> — Obsidian'");
  ok(log.menuTemplate[0].label==="TestVault" && log.menuTemplate[0].enabled===false, "first menu item = vault name (disabled header)");
  ok(log.menuTemplate.some(i=>i.label==="Show / Hide") && log.menuTemplate.some(i=>i.label==="Quit completely"), "existing menu items survive the added header");
  // ── single-instance relaunch, without the flicker ──
  //   Relaunching from the taskbar fires second-instance → restore the existing window and hide the vault picker at once.
  ok((appEvents["second-instance"]||[]).length===1, "registers the second-instance listener");
  ok((appEvents["browser-window-created"]||[]).length===1, "registers the browser-window-created listener");
  const shownBefore=log.shown, quitBefore=log.quit;
  remoteStub.app._emit("second-instance");
  ok(log.shown>shownBefore, "relaunch restores the existing window (show)");
  // The vault picker Obsidian opens right after (a new window, id=2) — supports show/ready-to-show.
  const picker={ id:2, _visible:true, hidden:0, closed:0, skipTaskbar:false, _ev:{},
    on(ev,fn){ (this._ev[ev]=this._ev[ev]||[]).push(fn); },
    fire(ev){ (this._ev[ev]||[]).forEach(f=>f()); },
    hide(){ this._visible=false; this.hidden++; }, close(){ this.closed++; },
    setSkipTaskbar(v){ this.skipTaskbar=v; },
    isDestroyed(){ return this.closed>0; }, isVisible(){ return this._visible; } };
  remoteStub.app._emit("browser-window-created", {preventDefault(){}}, picker);
  picker.fire("ready-to-show");
  picker.fire("show");
  ok(picker.hidden>=1 && picker._visible===false, "vault picker: hidden the moment it tries to appear (no flicker)");
  await new Promise(r=>setTimeout(r,220));
  ok(picker.closed===0, "vault picker: never closed (guards the window-all-closed regression)");
  ok(picker.skipTaskbar===true, "vault picker: dropped from the taskbar");
  ok(log.quit===quitBefore, "★regression guard: the running Obsidian is never quit or closed");
  // onunload: full cleanup (zero leaks)
  p.onunload();
  ok((appEvents["second-instance"]||[]).length===0 && (appEvents["browser-window-created"]||[]).length===0, "onunload: single-instance listeners removed (zero leaks)");
  ok((log.listeners["close"]||[]).length===0, "onunload: close listener removed (zero leaks)");
  ok(log.trayDestroyed===1, "onunload: tray destroyed");
  // ── vault-name fallback chain (1.0.8 fix: every vault showed the same tooltip) ──
  const pFallback = new PluginClass(mkApp({ getName(){ return "   "; }, adapter:{ getBasePath(){ return "D:\\Vaults\\PathVault\\"; } } }), {id:"background-tray"});
  await pFallback.onload();
  ok(log.tooltip==="PathVault — Obsidian", "getName() empty → vault name recovered from the vault path");
  ok(log.menuTemplate[0].label==="PathVault", "fallback vault name also reaches the menu header");
  pFallback.onunload();

  const pTitle = new PluginClass(mkApp({ getName(){ return ""; }, adapter:{} }), {id:"background-tray"});
  await pTitle.onload();
  ok(log.tooltip==="TitleVault — Obsidian", "getName() and path both fail → vault name recovered from the window title");
  pTitle.onunload();

  // quitCompletely: bypasses the interception via reallyQuitting, then closes
  const p2 = new PluginClass(app, {id:"background-tray"}); await p2.onload();
  p2.quitCompletely();
  ok(log.quit>=1, "quitCompletely: takes the real quit path");
  // Bypass check: while reallyQuitting, a close event must not be preventDefault-ed
  let prevented2=false; (log.listeners["close"]||[]).forEach(fn=>fn({preventDefault(){prevented2=true;}}));
  ok(prevented2===false, "close interception is bypassed while reallyQuitting");
  p2.onunload();
  console.log(fail===0 ? "\nALL PASS" : `\n${fail} FAIL`);
  process.exit(fail===0?0:1);
})();
