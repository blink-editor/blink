import { spawn } from "child_process"

export default function() {
  const ls = spawn(
    "../server/start.sh",
    null,
    { cwd: "../server/" }
  )

  ls.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`)
  })

  ls.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`)
  })

  ls.on("close", (code) => {
    console.log(`language server child process exited with code ${code}`)
  })

  return ls
}
