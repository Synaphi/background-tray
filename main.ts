import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";

/*
 * Background Tray — MVP (로드맵 1단계: Run in background + 트레이 아이콘)
 * 전역 단축키·빠른 노트·자동 실행 등은 후속 단계. 01. Spec / 00. OVERVIEW 참조.
 */

// 마지막 수단 fallback 아이콘 (16x16 PNG). 평소엔 app.getFileIcon 으로 실제 Obsidian 아이콘 사용.
const DEFAULT_TRAY_ICON =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR42mOosXr7nxLMMGrAqAGjBgwXAwBGOKIfCm+pOwAAAABJRU5ErkJggg==";

interface BackgroundTraySettings {
	runInBackground: boolean;
	createTrayIcon: boolean;
	focusOnRelaunch: boolean;
	trayIconPath: string;
	trayTooltip: string;
}

const DEFAULT_SETTINGS: BackgroundTraySettings = {
	runInBackground: true,
	createTrayIcon: true,
	focusOnRelaunch: true,
	trayIconPath: "",
	trayTooltip: "{{vault}} | Obsidian",
};

// 렌더러에서 Electron main 프로세스 모듈을 가져온다. 빌드별 경로 차이 → fallback.
function getRemote(): any {
	try {
		return require("@electron/remote");
	} catch (_) {
		/* legacy 시도 */
	}
	try {
		return (require("electron") as any).remote;
	} catch (_) {
		/* 접근 불가 */
	}
	return null;
}

export default class BackgroundTrayPlugin extends Plugin {
	settings!: BackgroundTraySettings;

	private remote: any = null;
	private win: any = null;
	private tray: any = null;
	private closeHandler: ((e: any) => void) | null = null;
	private beforeUnloadHandler: ((e: any) => void) | null = null;
	private secondInstanceHandler: (() => void) | null = null;
	private windowCreatedHandler: ((event: any, w: any) => void) | null = null;
	private lastRelaunchAt = 0;
	private reallyQuitting = false;

	async onload() {
		await this.loadSettings();

		this.remote = getRemote();
		if (!this.remote) {
			new Notice(
				"Background Tray: Electron 접근 불가 — 이 빌드에서는 트레이 기능을 사용할 수 없습니다."
			);
			// 앱은 절대 크래시 금지. 설정 탭만 노출하고 기능은 비활성.
			this.addSettingTab(new BackgroundTraySettingTab(this.app, this));
			return;
		}

		try {
			this.win = this.remote.getCurrentWindow();
		} catch (e) {
			console.error("Background Tray: getCurrentWindow 실패", e);
			this.win = null;
		}

		// ★ 닫기 가로채기는 두 층으로 건다:
		//   (1) beforeunload (렌더러 자체 이벤트) — Electron 39에서 신뢰성 있게 veto 되는 1차 방어.
		//   (2) window.on("close") (remote) — 일부 환경 fallback. Electron 39 @electron/remote 에서는
		//       preventDefault 가 무시되는 것을 실측 확인(01. Spec §3.1·§3.3) → beforeunload 가 실질 동작.
		this.registerBeforeUnload();
		this.registerCloseInterception();
		// 트레이에 숨은 상태에서 재실행 시 기존 창 복원(+ 보관함 선택창 억제).
		this.registerSingleInstance();

		if (this.settings.createTrayIcon) await this.createTray();

		// 커맨드 팔레트 (사용자가 단축키 매니저로 바인딩 가능)
		this.addCommand({
			id: "toggle-window",
			name: "Toggle window (show/hide)",
			callback: () => this.toggleWindow(),
		});
		this.addCommand({
			id: "quit-completely",
			name: "Quit completely",
			callback: () => this.quitCompletely(),
		});
		this.addCommand({
			id: "relaunch-obsidian",
			name: "Relaunch Obsidian",
			callback: () => this.relaunch(),
		});

		this.addSettingTab(new BackgroundTraySettingTab(this.app, this));
	}

	onunload() {
		// 01. Spec §3.4 정리 체크리스트 — 끄면 동작 100% 원복.
		this.removeBeforeUnload();
		this.removeCloseInterception();
		this.removeSingleInstance();
		this.destroyTray();
		try {
			this.win?.setSkipTaskbar(false);
		} catch (_) {}
		try {
			// (mac) dock 복원
			this.remote?.app?.dock?.show?.();
		} catch (_) {}
		this.win = null;
		this.remote = null;
	}

	// ── 닫기 가로채기 ① beforeunload (1차·실질 동작) ───────────────────
	// 렌더러 자체 이벤트라 remote 왕복 없이 동기적으로 닫기를 취소할 수 있다.
	private registerBeforeUnload() {
		if (typeof window === "undefined") return;
		this.removeBeforeUnload(); // 중복 등록 가드
		this.beforeUnloadHandler = (e: any) => {
			if (this.settings.runInBackground && !this.reallyQuitting) {
				e.preventDefault();
				e.returnValue = false; // Electron: 닫기 취소
				try {
					this.win?.hide(); // 트레이로 숨김
				} catch (_) {}
			}
		};
		window.addEventListener("beforeunload", this.beforeUnloadHandler);
	}

	private removeBeforeUnload() {
		if (typeof window !== "undefined" && this.beforeUnloadHandler) {
			window.removeEventListener("beforeunload", this.beforeUnloadHandler);
		}
		this.beforeUnloadHandler = null;
	}

	// ── 닫기 가로채기 ② window.on("close") (fallback) ─────────────────
	private registerCloseInterception() {
		if (!this.win) return;
		this.removeCloseInterception(); // 중복 등록 가드
		this.closeHandler = (e: any) => {
			if (this.settings.runInBackground && !this.reallyQuitting) {
				e.preventDefault();
				this.win.hide();
			}
		};
		try {
			this.win.on("close", this.closeHandler);
		} catch (e) {
			console.error("Background Tray: close 리스너 등록 실패", e);
			this.closeHandler = null;
		}
	}

	private removeCloseInterception() {
		if (this.win && this.closeHandler) {
			try {
				this.win.removeListener("close", this.closeHandler);
			} catch (_) {}
		}
		this.closeHandler = null;
	}

	// ── 단일 인스턴스 포커싱 ───────────────────────────────────────────
	// 트레이에 숨은 상태에서 Obsidian을 다시 실행하면, Obsidian은 second-instance 에서
	// 보관함 선택창을 새로 띄운다(실측). → 우리는 기존 창을 복원하고, 직후 생성되는 그
	// 선택창을 닫아 "기존 창 복귀"처럼 동작하게 한다. (Spec §4.6)
	private registerSingleInstance() {
		if (!this.remote || !this.win) return;
		const app = this.remote.app;
		if (!app || typeof app.prependListener !== "function") return;
		this.removeSingleInstance(); // 중복 등록 가드

		let myId = -1;
		try {
			myId = this.win.id;
		} catch (_) {}

		this.secondInstanceHandler = () => {
			if (!this.settings.focusOnRelaunch) return;
			this.lastRelaunchAt = Date.now();
			this.showWindow();
		};
		this.windowCreatedHandler = (_event: any, w: any) => {
			if (!this.settings.focusOnRelaunch) return;
			let id = -1;
			try {
				id = w.id;
			} catch (_) {}
			if (id === myId) return; // 우리 창은 건드리지 않음
			// second-instance 직후(짧은 창)에 생긴 새 창 = 보관함 선택창 → 닫는다.
			if (this.lastRelaunchAt > 0 && Date.now() - this.lastRelaunchAt < 4000) {
				setTimeout(() => {
					try {
						if (w && !w.isDestroyed()) w.close();
					} catch (_) {}
				}, 120);
			}
		};
		try {
			// 기존 창을 먼저 복원하도록 prepend.
			app.prependListener("second-instance", this.secondInstanceHandler);
			app.on("browser-window-created", this.windowCreatedHandler);
		} catch (e) {
			console.error("Background Tray: single-instance 등록 실패", e);
		}
	}

	private removeSingleInstance() {
		const app = this.remote?.app;
		if (app) {
			try {
				if (this.secondInstanceHandler)
					app.removeListener("second-instance", this.secondInstanceHandler);
			} catch (_) {}
			try {
				if (this.windowCreatedHandler)
					app.removeListener("browser-window-created", this.windowCreatedHandler);
			} catch (_) {}
		}
		this.secondInstanceHandler = null;
		this.windowCreatedHandler = null;
	}

	// ── 트레이 ───────────────────────────────────────────────────────
	private async createTray() {
		if (!this.remote) return;
		this.destroyTray(); // 중복 가드
		try {
			const { Tray, Menu } = this.remote;
			const icon = await this.resolveTrayIcon();

			this.tray = new Tray(icon);
			this.tray.setToolTip(this.renderTooltip());

			const menu = Menu.buildFromTemplate([
				{ label: "Show / Hide", click: () => this.toggleWindow() },
				{ type: "separator" },
				{ label: "Relaunch Obsidian", click: () => this.relaunch() },
				{ label: "Quit completely", click: () => this.quitCompletely() },
			]);
			this.tray.setContextMenu(menu);
			this.tray.on("click", () => this.toggleWindow());
		} catch (e) {
			console.error("Background Tray: 트레이 생성 실패", e);
			new Notice("Background Tray: 트레이 아이콘 생성에 실패했습니다.");
			this.tray = null;
		}
	}

	// 트레이 아이콘 결정: 커스텀 경로 → 실제 Obsidian 앱 아이콘 → fallback.
	private async resolveTrayIcon(): Promise<any> {
		const { nativeImage, app } = this.remote;
		// 1) 사용자 지정 경로
		if (this.settings.trayIconPath) {
			try {
				const c = nativeImage.createFromPath(this.settings.trayIconPath);
				if (c && !c.isEmpty()) return c;
			} catch (_) {}
		}
		// 2) 실제 Obsidian 실행 파일의 아이콘을 런타임에 추출 (번들 불필요)
		try {
			const img = await app.getFileIcon(process.execPath, { size: "normal" });
			if (img && !img.isEmpty()) return img;
		} catch (_) {}
		// 3) 마지막 수단 fallback
		return nativeImage.createFromDataURL(DEFAULT_TRAY_ICON);
	}

	private destroyTray() {
		if (this.tray) {
			try {
				this.tray.destroy();
			} catch (_) {}
		}
		this.tray = null;
	}

	private renderTooltip(): string {
		const vault = this.app.vault.getName();
		return (this.settings.trayTooltip || "{{vault}} | Obsidian").replace(
			/\{\{vault\}\}/g,
			vault
		);
	}

	// ── 창 동작 ──────────────────────────────────────────────────────
	toggleWindow() {
		if (!this.win) return;
		try {
			if (this.win.isVisible() && !this.win.isMinimized()) {
				this.win.hide();
			} else {
				this.showWindow();
			}
		} catch (e) {
			console.error("Background Tray: toggleWindow 실패", e);
		}
	}

	showWindow() {
		if (!this.win) return;
		try {
			if (this.win.isMinimized()) this.win.restore();
			this.win.show();
			this.win.focus();
		} catch (_) {}
	}

	quitCompletely() {
		this.reallyQuitting = true;
		try {
			if (this.win) this.win.close();
			else this.remote?.app?.quit();
		} catch (e) {
			console.error("Background Tray: quit 실패", e);
			try {
				this.remote?.app?.quit();
			} catch (_) {}
		}
	}

	relaunch() {
		try {
			this.reallyQuitting = true;
			this.remote?.app?.relaunch();
			this.remote?.app?.exit(0);
		} catch (e) {
			console.error("Background Tray: relaunch 실패", e);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// 설정 변경 시 트레이를 다시 만들어 즉시 반영
	async refreshTray() {
		this.destroyTray();
		if (this.remote && this.settings.createTrayIcon) await this.createTray();
	}
}

class BackgroundTraySettingTab extends PluginSettingTab {
	plugin: BackgroundTrayPlugin;

	constructor(app: App, plugin: BackgroundTrayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Run in background")
			.setDesc("창을 닫아도 종료하지 않고 트레이로 숨깁니다.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.runInBackground).onChange(async (v) => {
					this.plugin.settings.runInBackground = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Create tray icon")
			.setDesc("시스템 트레이에 아이콘을 만듭니다. (좌클릭: 표시/숨김 토글)")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.createTrayIcon).onChange(async (v) => {
					this.plugin.settings.createTrayIcon = v;
					await this.plugin.saveSettings();
					await this.plugin.refreshTray();
				})
			);

		new Setting(containerEl)
			.setName("Focus existing window on relaunch")
			.setDesc(
				"트레이에 숨은 상태에서 Obsidian을 다시 실행하면 새 보관함 선택창 대신 기존 창을 복원합니다."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.focusOnRelaunch).onChange(async (v) => {
					this.plugin.settings.focusOnRelaunch = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Tray icon image")
			.setDesc("커스텀 트레이 아이콘의 절대 경로 (비우면 Obsidian 기본 아이콘, 16x16 권장).")
			.addText((txt) =>
				txt
					.setPlaceholder("/path/to/icon.png")
					.setValue(this.plugin.settings.trayIconPath)
					.onChange(async (v) => {
						this.plugin.settings.trayIconPath = v.trim();
						await this.plugin.saveSettings();
						await this.plugin.refreshTray();
					})
			);

		new Setting(containerEl)
			.setName("Tray tooltip")
			.setDesc("{{vault}} → 볼트명으로 치환됩니다.")
			.addText((txt) =>
				txt
					.setValue(this.plugin.settings.trayTooltip)
					.onChange(async (v) => {
						this.plugin.settings.trayTooltip = v;
						await this.plugin.saveSettings();
						await this.plugin.refreshTray();
					})
			);
	}
}
