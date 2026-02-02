import { exec } from 'child_process'
import { NextResponse } from 'next/server'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function GET() {
  try {
    // Check if the Docker container is running by trying to connect to SSH port
    const { stdout } = await execAsync('nc -z localhost 2222', { timeout: 5000 })

    return NextResponse.json({
      running: true,
      message: 'Docker SSH container is accessible on port 2222'
    })
  } catch (error) {
    // Also try to check via Docker commands
    try {
      const { stdout } = await execAsync('docker ps --filter "name=agent-backend-remote" --format "{{.Status}}"', { timeout: 5000 })

      if (stdout.trim().startsWith('Up')) {
        return NextResponse.json({
          running: true,
          message: 'Docker container is running but SSH might not be ready yet'
        })
      }
    } catch (dockerError) {
      // Docker command failed, container is probably not running
    }

    return NextResponse.json({
      running: false,
      message: 'Docker SSH container is not running or not accessible'
    })
  }
}