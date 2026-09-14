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
const log = { listeners:{}, hidden:0, shown:0, focused:0, trayCreated:0, trayDestroyed:0, prevented:0, quit:0, appQuit:0, closeSeq:[] };
const fakeWin = {
  _visible:true, _min:false,
  on(ev,fn){ (log.listeners[ev]=log.listeners[ev]||[]).push(fn); },
  removeListener(ev,fn){ log.listeners[ev]=(log.listeners[ev]||[]).filter(f=>f!==fn); },
  hide(){ this._visible=false; log.hidden++; },
  show(){ this._visible=true; log.shown++; },
  showInactive(){ this._visible=true; log.shownInactive=(log.shownInactive||0)+1; },
  focus(){ log.focused++; },
  isVisible(){ return this._visible; }, isMinimized(){ return this._min; }, restore(){ this._min=false; },
  close(){ log.quit++; log.closeSeq.push("win.close"); }, setSkipTaskbar(){}, isDestroyed(){ return false; }, id:1,
};
class Tray { constructor(i){ this.icon=i; log.trayCreated++; } setToolTip(t){ log.tooltip=t; } setContextMenu(){} on(){} destroy(){ log.trayDestroyed++; } }
const Menu = { buildFromTemplate(t){ log.menuTemplate=t; return {_t:t}; } };
const nativeImage = { createFromPath(){ return {isEmpty(){return true;}}; }, createFromDataURL(){ return {isEmpty(){return false;}}; }, createEmpty(){ return {}; } };
// Registry of app (main-process) events — used to exercise the single-instance relaunch path.
const appEvents = {};
const remoteStub = { getCurrentWindow(){ return fakeWin; }, Tray, Menu, nativeImage, app:{
  quit(){log.quit++; log.appQuit++;}, relaunch(){ log.closeSeq.push("app.relaunch"); }, exit(){ log.closeSeq.push("app.exit"); }, dock:{show(){}},
  emit(ev){ log.closeSeq.push("emit:"+ev); return true; },
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
const _winListeners = {}; const _winCapture = new Map();
// Secondary windows (pop-outs / the Settings window) are DOM windows from window.open, each tagged
// with its BrowserWindow the way Obsidian does (window.electronWindow).
const mkSecondary=(id)=>({ closed:false, electronWindow:{ id, _visible:true, hidden:0, shown:0, shownInactive:0, destroyed:false,
  hide(){ this._visible=false; this.hidden++; }, show(){ this._visible=true; this.shown++; }, showInactive(){ this._visible=true; this.shownInactive++; },
  isVisible(){ return this._visible; }, isDestroyed(){ return this.destroyed; } } });
const _origOpen = function(){ _origOpen.count=(_origOpen.count||0)+1; return mkSecondary(100+_origOpen.count); };
global.window = {
  require,
  addEventListener(ev, fn, opts){ (_winListeners[ev]=_winListeners[ev]||[]).push(fn); _winCapture.set(fn, !!(opts&&opts.capture)); },
  removeEventListener(ev, fn){ _winListeners[ev]=(_winListeners[ev]||[]).filter(f=>f!==fn); },
  setTimeout: (fn, t) => setTimeout(fn, t),
  open: _origOpen,
};

global.document = { title: "Some note - TitleVault - Obsidian v1.12.0" };

const PluginClass = require("./main.js").default || require("./main.js");
const mkApp = (vault) => ({ vault, workspace:{ onLayoutReady(cb){ cb(); }, floatingSplit:{ children:[] } }, setting:{ popout:null } });
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
  const mkPicker=(id)=>({ id, _visible:true, hidden:0, closed:0, destroyed:0, skipTaskbar:false, _ev:{},
    on(ev,fn){ (this._ev[ev]=this._ev[ev]||[]).push(fn); },
    fire(ev){ (this._ev[ev]||[]).forEach(f=>f()); },
    hide(){ this._visible=false; this.hidden++; }, close(){ this.closed++; }, destroy(){ this.destroyed++; },
    setSkipTaskbar(v){ this.skipTaskbar=v; },
    isDestroyed(){ return this.closed>0 || this.destroyed>0; }, isVisible(){ return this._visible; }, isResizable(){ return false; } });
  const picker=mkPicker(2);
  remoteStub.app._emit("browser-window-created", {preventDefault(){}}, picker);
  picker.fire("ready-to-show");
  picker.fire("show");
  ok(picker.hidden>=1 && picker._visible===false, "vault picker: hidden the moment it tries to appear (no flicker)");
  await new Promise(r=>setTimeout(r,220));
  ok(picker.closed===0, "vault picker: never closed (guards the window-all-closed regression)");
  ok(picker.skipTaskbar===true, "vault picker: dropped from the taskbar");
  ok(log.quit===quitBefore, "★regression guard: the running Obsidian is never quit or closed");
  ok(picker.destroyed===0, "vault picker: kept alive while Obsidian keeps running");
  // A resizable window (another vault opened via obsidian:// link, or a pop-out) in the same 4 s must be left alone.
  const vaultWin=mkPicker(9); vaultWin.isResizable=()=>true;
  remoteStub.app._emit("browser-window-created", {preventDefault(){}}, vaultWin);
  vaultWin.fire("show");
  ok(vaultWin.hidden===0 && vaultWin.skipTaskbar===false, "resizable window created right after relaunch (vault window / pop-out): never hidden");
  // onunload: full cleanup (zero leaks)
  p.onunload();
  ok(picker.destroyed===1, "onunload: the hidden vault picker is destroyed (issue #3: no headless leftover)");
  ok(vaultWin.destroyed===0, "onunload: the vault window is not tracked, so it is not destroyed");
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

  // ── issue #3: Quit completely must end the whole app, even with a hidden vault picker around ──
  //   Obsidian only quits on window-all-closed; a hidden picker left behind kept the process alive with no window.
  const p2 = new PluginClass(app, {id:"background-tray"}); await p2.onload();
  remoteStub.app._emit("second-instance");
  const picker2=mkPicker(3);
  remoteStub.app._emit("browser-window-created", {preventDefault(){}}, picker2);
  picker2.fire("show");
  const appQuitBefore=log.appQuit; log.closeSeq=[];
  picker2.destroy=function(){ this.destroyed++; log.closeSeq.push("picker.destroy"); };
  p2.quitCompletely();
  ok(log.closeSeq.join(">")==="picker.destroy>win.close", "quitCompletely: destroys the hidden vault picker, THEN closes our window (order verified)");
  ok(log.appQuit===appQuitBefore, "quitCompletely: closes only this vault's window — never app.quit() (other open vaults keep running)");
  // Bypass check: while reallyQuitting, a close event must not be preventDefault-ed
  let prevented2=false; (log.listeners["close"]||[]).forEach(fn=>fn({preventDefault(){prevented2=true;}}));
  ok(prevented2===false, "close interception is bypassed while reallyQuitting");
  p2.onunload();

  // ── issue #3 (b): a real close with "Run in background" OFF also takes the hidden picker along ──
  const p3 = new PluginClass(app, {id:"background-tray"}); await p3.onload();
  p3.settings.runInBackground=false;
  remoteStub.app._emit("second-instance");
  const picker3=mkPicker(4);
  remoteStub.app._emit("browser-window-created", {preventDefault(){}}, picker3);
  const hiddenBefore3=log.hidden;
  let prevented3=false; (log.listeners["close"]||[]).forEach(fn=>fn({preventDefault(){prevented3=true;}}));
  ok(prevented3===false && log.hidden===hiddenBefore3, "run-in-background OFF: close is not intercepted");
  ok(picker3.destroyed===1, "run-in-background OFF: the hidden vault picker is destroyed on the real close");
  p3.onunload();

  // ── issue #3 (c): turning "Focus existing window on relaunch" off releases the hidden picker ──
  const p4 = new PluginClass(app, {id:"background-tray"}); await p4.onload();
  remoteStub.app._emit("second-instance");
  const picker4=mkPicker(5);
  remoteStub.app._emit("browser-window-created", {preventDefault(){}}, picker4);
  // The Setting stub swallows onChange callbacks, so call what the toggle's onChange(false) calls.
  p4.settings.focusOnRelaunch=false; p4.destroyHiddenPickers();
  ok(picker4.destroyed===1, "focusOnRelaunch OFF: the hidden vault picker is destroyed");
  p4.onunload();

  // ── issue #3 follow-up (a): pop-outs and the Settings window hide and come back with the main window ──
  //   Obsidian's own onbeforeunload treats a close of the main window as a quit and CLOSES every pop-out;
  //   the plugin must veto first (capture) and stop that hook, then hide the whole vault.
  const appS = mkApp({ getName(){ return "TestVault"; }, adapter:{ getBasePath(){ return "C:\\Obsidian\\TestVault"; } } });
  const p5 = new PluginClass(appS, {id:"background-tray"}); await p5.onload();
  const bu=(_winListeners["beforeunload"]||[]);
  ok(bu.length===1 && _winCapture.get(bu[0])===true, "beforeunload listener registered in the capture phase (runs before Obsidian's quit hook)");
  ok(global.window.open!==_origOpen, "window.open is wrapped to learn about pop-out / Settings windows");
  const popA = global.window.open("about:blank","_blank","popup");          // e.g. the Settings window
  const popB = global.window.open("about:blank","_blank","popup");          // e.g. Move to new window
  const popLayout = mkSecondary(300); appS.workspace.floatingSplit.children.push({ win: popLayout }); // pop-out restored with the layout, never seen by window.open
  const popHiddenAlready = global.window.open("about:blank","_blank","popup"); popHiddenAlready.electronWindow._visible=false;
  const closedPop = global.window.open("about:blank","_blank","popup"); closedPop.closed=true;
  fakeWin._visible=true; const hiddenB=log.hidden, shownB=log.shown, focusedB=log.focused;
  let prevented5=false, stopped5=false;
  bu.forEach(fn=>fn({ preventDefault(){prevented5=true;}, stopImmediatePropagation(){stopped5=true;} }));
  ok(prevented5===true && stopped5===true, "X while running in background: close vetoed AND Obsidian's quit hook stopped (pop-outs are not closed)");
  ok(log.hidden===hiddenB+1 && fakeWin._visible===false, "X: main window hidden");
  ok(popA.electronWindow.hidden===1 && popB.electronWindow.hidden===1 && popLayout.electronWindow.hidden===1, "X: every visible secondary window is hidden with it (window.open-tracked and layout pop-outs)");
  ok(popHiddenAlready.electronWindow.hidden===0, "a secondary window that was already hidden is left alone");
  p5.showWindow();
  ok(log.shown===shownB+1 && log.focused===focusedB+1, "show: main window shown and focused");
  ok(popA.electronWindow.shownInactive===1 && popB.electronWindow.shownInactive===1 && popLayout.electronWindow.shownInactive===1, "show: the hidden secondary windows come back (without stealing focus)");
  ok(popHiddenAlready.electronWindow.shownInactive===0 && popHiddenAlready.electronWindow.shown===0, "show: a window we did not hide is not shown");
  // hide via tray / command → same treatment, and a window closed meanwhile is skipped
  p5.hideWindow(); popB.electronWindow.destroyed=true; p5.showWindow();
  ok(popA.electronWindow.hidden===2 && popA.electronWindow.shownInactive===2 && popB.electronWindow.shownInactive===1, "tray hide/show: same for secondaries; a window destroyed while hidden is skipped");
  // a real quit must NOT stop Obsidian's quit hook (it saves the layout and closes pop-outs itself)
  p5.reallyQuitting=true; let stopped5b=false, prevented5b=false;
  bu.forEach(fn=>fn({ preventDefault(){prevented5b=true;}, stopImmediatePropagation(){stopped5b=true;} }));
  ok(prevented5b===false && stopped5b===false, "real quit: beforeunload passes through untouched");
  p5.reallyQuitting=false; p5.hideWindow();
  p5.onunload();
  ok(global.window.open===_origOpen, "onunload: window.open restored");
  ok(popA.electronWindow.shownInactive===3, "onunload: secondary windows hidden by the plugin are shown again (nothing stays invisible)");

  // ── issue #3 follow-up (b): Relaunch with a hidden vault picker (or several vaults) around ──
  //   app.exit() fires "closed" per window without a before-quit; Obsidian's handler then marks the vault
  //   as not open when another window still exists → the relaunched Obsidian showed the vault picker.
  const p6 = new PluginClass(app, {id:"background-tray"}); await p6.onload();
  remoteStub.app._emit("second-instance");
  const picker6=mkPicker(6); picker6.destroy=function(){ this.destroyed++; log.closeSeq.push("picker.destroy"); };
  remoteStub.app._emit("browser-window-created", {preventDefault(){}}, picker6);
  log.closeSeq=[]; p6.relaunch();
  ok(log.closeSeq.join(">")==="picker.destroy>emit:before-quit>app.relaunch>app.exit", "relaunch: destroy hidden picker → before-quit → relaunch → exit (order verified)");
  p6.onunload();
  console.log(fail===0 ? "\nALL PASS" : `\n${fail} FAIL`);
  process.exit(fail===0?0:1);
})();
