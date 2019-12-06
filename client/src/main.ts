// Modules to control application life and create native browser window
import { app, App, BrowserWindow, ipcMain } from "electron"
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
		app.on("ready", this.createInstance.bind(this))

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
	}

	terminate() {
		// Kill the servers when the application terminates.
		this.instances.clear()
	}

	createInstance() {
		// Create the browser window.
		const window = new BrowserWindow({
			width: 824,
			height: 826,
			minHeight: 826,
			minWidth: 824,
			webPreferences: {
				// contextIsolation: true,
				preload: path.join(__dirname, "preload.js"),
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
