import { spawn, ChildProcess } from "child_process"

export enum ServerState {
	Started,
	Running,
	Killed,
}

/**
 * Abstracts spawning and shutting down the backing server.
 */
export interface ServerManager {
	/**
	 * The current state of the server.
	 */
	readonly state: ServerState

	/**
	 * Starts the server. Does nothing if already up.
	 *
	 * @param  callback  Called when the server has started.
	 */
	spawn(callback: () => void): void

	/**
	 * Kills the server. Does nothing if already killed.
	 */
	kill(): void
}

export class ServerManagerImpl {
	public state: ServerState = ServerState.Killed
	private serverProcess?: ChildProcess = undefined

	public spawn(callback) {
		if (this.state !== ServerState.Killed) {
			return
		}

		const ls = spawn(
			"sh",
			["../server/start.sh"],
			{ cwd: "../server/" }
		)

		this.state = ServerState.Started

		ls.stdout.on("data", (data) => {
			// the first time we receive output, we update our
			// state and call the provided callback function
			if (this.state == ServerState.Started) {
				this.state = ServerState.Running
				callback()
			}

			console.log(`stdout: ${data}`)
		})

		ls.stderr.on("data", (data) => {
			if (this.state == ServerState.Started) {
				this.state = ServerState.Running
				callback()
			}

			console.error(`stderr: ${data}`)
		})

		ls.on("close", (code) => {
			console.log(`language server child process exited with code ${code}`)
			this.state = ServerState.Killed
		})

		this.serverProcess = ls
	}

	public kill() {
		if (this.state === ServerState.Killed) {
			return
		}

		this.serverProcess?.kill()
		this.serverProcess = undefined
		this.state = ServerState.Killed
	}
}
