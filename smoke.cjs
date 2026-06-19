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
  close(){ log.quit++; }, setSkipTaskbar(){},
};
class Tray { constructor(i){ this.icon=i; log.trayCreated++; } setToolTip(){} setContextMenu(){} on(){} destroy(){ log.trayDestroyed++; } }
const Menu = { buildFromTemplate(t){ return {_t:t}; } };
const nativeImage = { createFromPath(){ return {isEmpty(){return true;}}; }, createFromDataURL(){ return {isEmpty(){return false;}}; }, createEmpty(){ return {}; } };
const remoteStub = { getCurrentWindow(){ return fakeWin; }, Tray, Menu, nativeImage, app:{ quit(){log.quit++;}, relaunch(){}, exit(){}, dock:{show(){}} } };

Module._load = function(req, parent, isMain){
  if (req === "obsidian") return obsidianStub;
  if (req === "@electron/remote") return remoteStub;
  if (req === "electron") return { remote: remoteStub };
  return origLoad.apply(this, arguments);
};

const PluginClass = require("./main.js").default || require("./main.js");
const app = { vault:{ getName(){ return "TestVault"; } } };
const p = new PluginClass(app, { id:"background-tray" });

(async () => {
  let fail=0; const ok=(c,m)=>{ console.log((c?"  PASS":"  FAIL")+" — "+m); if(!c)fail++; };
  await p.onload();
  ok(log.trayCreated===1, "트레이 1개 생성");
  ok((log.listeners["close"]||[]).length===1, "close 리스너 1개 등록");
  ok(p._commands.length===3, "커맨드 3개 등록(toggle/quit/relaunch)");
  // 닫기 시뮬레이션: runInBackground 기본 ON → preventDefault + hide
  let prevented=false; const ev={preventDefault(){prevented=true;}};
  (log.listeners["close"]||[]).forEach(fn=>fn(ev));
  ok(prevented===true, "닫기 가로채기: preventDefault 호출");
  ok(log.hidden===1, "닫기 시 창 hide");
  // toggle: 지금 숨김상태 → show+focus
  p.toggleWindow();
  ok(log.shown===1 && log.focused===1, "toggleWindow 로 창 복귀");
  // onunload: 완전 정리(누수 0)
  p.onunload();
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
