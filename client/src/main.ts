// Modules to control application life and create native browser window
import { app, App, BrowserWindow } from "electron"
import "process"
import * as path from "path"
import { ServerManager, ServerManagerImpl } from "./server-manager"

class Application {
	private windows = new Map<number, Electron.BrowserWindow>()
	private serverManager: ServerManager

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

		if (process.platform === "darwin") {
			app.on("activate", () => {
				// On macOS it's common to re-create a window in the app when the
				// dock icon is clicked and there are no other windows open.
				if (this.windows.size == 0) {
					this.createWindow()
				}
			})
		} else {
			// Quit when all windows are closed.
			// On macOS it is common for applications and their menu bar
			// to stay active until the user quits explicitly with Cmd + Q
			app.on("window-all-closed", () => app.quit())
		}
	}

	ready() {
		this.serverManager = new ServerManagerImpl()
		this.serverManager.spawn(() => {
			// notify our windows that the server is connected
			this.windows.forEach((w) => w.webContents.send("server-connected"))
		})

		this.createWindow()
	}

	terminate() {
		// Kill the server when the application terminates.
		this.serverManager.kill()
	}

	createWindow() {
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
			this.windows.delete(windowId)
		})

		this.windows.set(windowId, window)

		if (this.serverManager.running) {
			window.webContents.send("server-connected")
		}
	}
}

// Keep a global reference of the application object, if you don't, the app will
// be closed automatically when the JavaScript object is garbage collected.
const application = new Application(app, process)
console.log(`main.ts ${application}`)
