// 번들된 main.js를 stub 환경에서 로드해 핵심 경로를 검증한다 (Electron 런타임 없이).
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
const Menu = { buildFromTemplate(t){ return {_t:t}; } };
const nativeImage = { createFromPath(){ return {isEmpty(){return true;}}; }, createFromDataURL(){ return {isEmpty(){return false;}}; }, createEmpty(){ return {}; } };
// app(main 프로세스) 이벤트 레지스트리 — 단일 인스턴스(재실행) 경로 검증용.
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

// ── window 전역 stub ── 렌더러의 window.require / beforeunload / setTimeout 흉내.
const _winListeners = {};
global.window = {
  require,
  addEventListener(ev, fn){ (_winListeners[ev]=_winListeners[ev]||[]).push(fn); },
  removeEventListener(ev, fn){ _winListeners[ev]=(_winListeners[ev]||[]).filter(f=>f!==fn); },
  setTimeout: (fn, t) => setTimeout(fn, t),
};

const PluginClass = require("./main.js").default || require("./main.js");
const app = { vault:{ getName(){ return "TestVault"; } } };
const p = new PluginClass(app, { id:"background-tray" });

(async () => {
  let fail=0; const ok=(c,m)=>{ console.log((c?"  PASS":"  FAIL")+" — "+m); if(!c)fail++; };
  await p.onload();
  ok(log.trayCreated===1, "트레이 1개 생성");
  ok((log.listeners["close"]||[]).length===1, "close 리스너 1개 등록");
  ok(p._commands.length===0, "커맨드 미등록(단일목적·단축키 버튼 제거)");
  // 닫기 시뮬레이션: runInBackground 기본 ON → preventDefault + hide
  let prevented=false; const ev={preventDefault(){prevented=true;}};
  (log.listeners["close"]||[]).forEach(fn=>fn(ev));
  ok(prevented===true, "닫기 가로채기: preventDefault 호출");
  ok(log.hidden===1, "닫기 시 창 hide");
  // toggle: 지금 숨김상태 → show+focus
  p.toggleWindow();
  ok(log.shown===1 && log.focused===1, "toggleWindow 로 창 복귀");
  // ── 트레이 툴팁 기본값(작업 1) ──
  ok(log.tooltip==="TestVault - Background Tray", "트레이 툴팁 = '<vault> - Background Tray'");
  // ── 단일 인스턴스 재실행 깜빡임 수정(작업 2) ──
  //   작업표시줄에서 다시 켜면 second-instance → 기존 창 복원 + 보관함 선택창 즉시 숨김.
  ok((appEvents["second-instance"]||[]).length===1, "second-instance 리스너 등록");
  ok((appEvents["browser-window-created"]||[]).length===1, "browser-window-created 리스너 등록");
  const shownBefore=log.shown, quitBefore=log.quit;
  remoteStub.app._emit("second-instance");
  ok(log.shown>shownBefore, "재실행 시 기존 창 복원(show)");
  // Obsidian이 직후 만드는 보관함 선택창(새 창, id=2) — show/ready-to-show 이벤트 지원.
  const picker={ id:2, _visible:true, hidden:0, closed:0, skipTaskbar:false, _ev:{},
    on(ev,fn){ (this._ev[ev]=this._ev[ev]||[]).push(fn); },
    fire(ev){ (this._ev[ev]||[]).forEach(f=>f()); },
    hide(){ this._visible=false; this.hidden++; }, close(){ this.closed++; },
    setSkipTaskbar(v){ this.skipTaskbar=v; },
    isDestroyed(){ return this.closed>0; }, isVisible(){ return this._visible; } };
  remoteStub.app._emit("browser-window-created", {preventDefault(){}}, picker);
  picker.fire("ready-to-show");
  picker.fire("show");
  ok(picker.hidden>=1 && picker._visible===false, "보관함 선택창: 보이려 할 때 즉시 숨김(깜빡임 방지)");
  await new Promise(r=>setTimeout(r,220));
  ok(picker.closed===0, "보관함 선택창: close 하지 않음(window-all-closed 회귀 방지)");
  ok(picker.skipTaskbar===true, "보관함 선택창: 작업표시줄 제외");
  ok(log.quit===quitBefore, "★회귀 방지: 기존 Obsidian 종료/창 닫힘 없음(quit 미호출)");
  // onunload: 완전 정리(누수 0)
  p.onunload();
  ok((appEvents["second-instance"]||[]).length===0 && (appEvents["browser-window-created"]||[]).length===0, "onunload: single-instance 리스너 제거(누수 0)");
  ok((log.listeners["close"]||[]).length===0, "onunload: close 리스너 제거(누수 0)");
  ok(log.trayDestroyed===1, "onunload: 트레이 destroy");
  // quitCompletely: reallyQuitting 우회 후 close
  const p2 = new PluginClass(app, {id:"background-tray"}); await p2.onload();
  p2.quitCompletely();
  ok(log.quit>=1, "quitCompletely: 실제 종료 경로 호출");
  // 닫기 가로채기 우회 검증: reallyQuitting 상태에서 close 이벤트 → preventDefault 안 함
  let prevented2=false; (log.listeners["close"]||[]).forEach(fn=>fn({preventDefault(){prevented2=true;}}));
  ok(prevented2===false, "reallyQuitting 시 닫기 가로채기 우회");
  p2.onunload();
  console.log(fail===0 ? "\nALL PASS" : `\n${fail} FAIL`);
  process.exit(fail===0?0:1);
})();
