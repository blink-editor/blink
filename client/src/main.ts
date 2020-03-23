// Modules to control application life and create native browser window
import { app, App, BrowserWindow, ipcMain, Menu } from "electron"
import "process"
import * as path from "path"
import { ServerManager, ServerManagerImpl } from "./server-manager"

interface Instance {
	id: number
	window: Electron.BrowserWindow
	serverManager: ServerManager
}

class Application {
	private instances = new Map<number, Instance>()

	constructor(app: Electron.App, process: NodeJS.Process) {
		// This method will be called when Electron has finished
		// initialization and is ready to create browser windows.
		// Some APIs can only be used after this event occurs.
		app.on("ready", this.ready.bind(this))

		// catch various events that signify application termination
		// in order to guarantee we shut down child processes
		process.on("exit", this.terminate.bind(this))
		process.on("SIGINT", this.terminate.bind(this))
		process.on("SIGTERM", this.terminate.bind(this))
		app.on("before-quit", this.terminate.bind(this))

		// Quit when all windows are closed.
		app.on("window-all-closed", () => {
			// On macOS it is common for applications and their menu bar
			// to stay active until the user quits explicitly with Cmd + Q
			if (process.platform !== "darwin") {
				app.quit()
			}
		})

		app.on("activate", () => {
			// On macOS it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open.
			if (this.instances.size == 0) {
				this.createInstance()
			}
		})

		ipcMain.on("try-starting-server", (event) => {
			const instance = this.instances.get(event.sender.id)
			if (instance) {
				this._spawnServerForInstance(instance)
			}
		})
	}

	ready() {
		this.createInstance()

		// Keyboard Shortcut Template.
		const isMac = process.platform === "darwin"

		const sendRendererMessage = (message: string): void => {
			for (const [_, instance] of this.instances)
				instance.window.webContents.send(message)
		}

		const template = [
		// { role: "appMenu" }
		...(isMac ? [{
			label: app.name,
			submenu: [
			{ role: "about" },
			{ type: "separator" },
			{ role: "services" },
			{ type: "separator" },
			{ role: "hide" },
			{ role: "hideothers" },
			{ role: "unhide" },
			{ type: "separator" },
			{ role: "quit" }
			]
		}] : []),
		// { role: "fileMenu" }
		{
			label: "File",
			submenu: [
				// Basic Commands
				{
					label: "Open Project...",
					accelerator: isMac ? "Cmd+O" : "Ctrl+O",
					click: () => sendRendererMessage("Open")
				},
				{
					label: "Save Project",
					accelerator: isMac ? "Cmd+S" : "Ctrl+S",
					click: () => sendRendererMessage("Save")
				},
				{
					label: "New Project",
					accelerator: isMac ? "Cmd+Shift+N" : "Ctrl+Shift+N",
					click: () => sendRendererMessage("NewProject")
				},
				{ type: "separator" },
			isMac ? { role: "close" } : { role: "quit" }
			]
		},
		// { role: "editMenu" }
		{
			label: "Edit",
			submenu: [
			{
				label: "Undo",
				accelerator: isMac ? "Cmd+Z" : "Ctrl+Z",
				click: () => sendRendererMessage("Undo")
			},
				{
					label: "Redo",
					accelerator: isMac ? "Cmd+Shift+Z" : "Ctrl+Shift+Z",
					click: () => sendRendererMessage("Redo")
				},
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{
				label: "Select All",
				accelerator: isMac ? "Cmd+A" : "Ctrl+A",
				click: () => sendRendererMessage("SelectAll")
			},
			...(isMac ? [
				{ role: "delete" },
				{ type: "separator" },
				{
				label: "Speech",
				submenu: [
					{ role: "startspeaking" },
					{ role: "stopspeaking" }
				]
				}
			] : [
				{ role: "delete" },
				{ type: "separator" },
			])
			]
		},
		// Our custom navigation shortcuts
		{
			label: "Navigate",
			submenu: [
				// Jump to preview pane
				{
					label: "Jump To Preview Pane 1",
					accelerator: isMac ? "Cmd+1" : "Ctrl+1",
					click: () => sendRendererMessage("JumpPane1")
				},
				{
					label: "Jump To Preview Pane 2",
					accelerator: isMac ? "Cmd+2" : "Ctrl+2",
					click: () => sendRendererMessage("JumpPane2")
				},
				{
					label: "Jump To Preview Pane 3",
					accelerator: isMac ? "Cmd+3" : "Ctrl+3",
					click: () => sendRendererMessage("JumpPane3")
				},
				{
					label: "Jump To Preview Pane 4",
					accelerator: isMac ? "Cmd+4" : "Ctrl+4",
					click: () => sendRendererMessage("JumpPane4")
				},
				{
					label: "Jump To Preview Pane 5",
					accelerator: isMac ? "Cmd+5" : "Ctrl+5",
					click: () => sendRendererMessage("JumpPane5")
				},
				{
					label: "Jump To Preview Pane 6",
					accelerator: isMac ? "Cmd+6" : "Ctrl+6",
					click: () => sendRendererMessage("JumpPane6")
				},
				{ type: "separator" },
				// Nav Stack
				{
					label: "Navigate Back",
					accelerator: isMac ? "Cmd+[" : "Ctrl+[",
					click: () => sendRendererMessage("NavigateBack")
				},
				{
					label: "Navigate Forward",
					accelerator: isMac ? "Cmd+]" : "Ctrl+]",
					click: () => sendRendererMessage("navigateForward")
				},
				{ type: "separator" },
				// Paging preview panes
				{
					label: "Page Callers Forward",
					accelerator: isMac ? "Cmd+Alt+Up" : "Ctrl+Alt+Up",
					click: () => sendRendererMessage("PanePageUp")
				},
				{
					label: "Page Callers Back",
					accelerator: isMac ? "Cmd+Alt+Down" : "Ctrl+Alt+Down",
					click: () => sendRendererMessage("PanePageDown")
				},
				{
					label: "Page Callees Forward",
					accelerator: isMac ? "Cmd+Alt+Right" : "Ctrl+Alt+Right",
					click: () => sendRendererMessage("PanePageRight")
				},
				{
					label: "Page Callees Back",
					accelerator: isMac ? "Cmd+Alt+Left" : "Ctrl+Alt+Left",
					click: () => sendRendererMessage("PanePageLeft")
				},
				{ type: "separator" },
				{
					label: "Jump to Symbol by Name",
					accelerator: isMac ? "Cmd+Shift+O" : "Ctrl+Shift+O",
					click: () => sendRendererMessage("JumpByName")
				},
			]
		},
		// { role: "viewMenu" }
		{
			label: "View",
			submenu: [
			{ role: 'reload' },
			{ role: 'forcereload' },
			{ role: 'toggledevtools' },
			{ type: 'separator' },
			{ role: 'resetzoom' },
			{ role: 'zoomin', accelerator: isMac ? 'Cmd+=' : 'Ctrl+=', },
			{ role: 'zoomout' },
			{ type: 'separator' },
			{ role: 'togglefullscreen' }
			]
		},
		// { role: "windowMenu" }
		{
			label: "Window",
			submenu: [
			{ role: "minimize" },
			{ role: "zoom" },
			...(isMac ? [
				{ type: "separator" },
				{ role: "front" },
				{ type: "separator" },
				{ role: "window" }
			] : [
				{ role: "close" }
			])
			]
		},
		{
			role: "help",
			submenu: []
		}
		] as Electron.MenuItemConstructorOptions[]

		const menu = Menu.buildFromTemplate(template)

		Menu.setApplicationMenu(menu)
	}

	terminate() {
		// Kill the servers when the application terminates.
		this.instances.clear()
	}

	createInstance() {
		// Create the browser window.
		const window = new BrowserWindow({
			width: 1200,
			height: 796,
			backgroundColor: '#2e2c29',
			webPreferences: {
				// contextIsolation: true,
				nodeIntegration: true // TODO: Set up web pack
			},
		})

		// and load the index.html of the app.
		window.loadFile("index.html")

		// Open the DevTools.
		window.webContents.openDevTools()

		// Emitted when the window is closed.
		const windowId = window.id
		window.on("closed", () => {
			this.instances.delete(windowId)
		})

		const serverManager = new ServerManagerImpl()

		const instance = {
			id: windowId,
			window: window,
			serverManager: serverManager,
		}

		this.instances.set(windowId, instance)

		this._spawnServerForInstance(instance)
	}

	_spawnServerForInstance(instance: Instance) {
		instance.serverManager.spawn(() => {
			if (this.instances.get(instance.id)) {
				instance.window.webContents.send("server-connected")
			}
		})
	}
}

// Keep a global reference of the application object, if you don't, the app will
// be closed automatically when the JavaScript object is garbage collected.
const application = new Application(app, process)
console.log(`main.ts ${application}`)
