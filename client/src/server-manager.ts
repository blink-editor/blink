import { spawn, ChildProcess } from "child_process"

/**
 * Abstracts spawning and shutting down the backing server.
 */
export interface ServerManager {
	/**
	 * If the server is currently running.
	 */
	running: boolean

	/**
	 * Starts the server.
	 * Must not be called sequentially without calling kill() in between.
	 *
	 * @param  callback  Called when the server has started.
	 */
	spawn(callback: () => void): void

	/**
	 * Kills the server.
	 * May be called multiple times without first calling spawn().
	 */
	kill(): void
}

export class ServerManagerImpl {
	private serverProcess?: ChildProcess = undefined

	public spawn(callback) {
		const ls = spawn(
			"sh",
			["../server/start.sh"],
			{ cwd: "../server/" }
		)

		// the first time we receive output, we set notified = true
		// and call the provided callback function
		let notified = false

		ls.stdout.on("data", (data) => {
			if (!notified) {
				callback()
				notified = true
			}

			console.log(`stdout: ${data}`)
		})

		ls.stderr.on("data", (data) => {
			if (!notified) {
				callback()
				notified = true
			}

			console.error(`stderr: ${data}`)
		})

		ls.on("close", (code) => {
			console.log(`language server child process exited with code ${code}`)
		})

		this.serverProcess = ls
	}

	public kill() {
		this.serverProcess?.kill()
		this.serverProcess = undefined
	}

	public get running(): boolean {
		return this.serverProcess !== undefined
	}
}
