import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface TrackedProcess {
  pid: number;
  script: string;
  startTime: number;
  type: 'python' | 'led';
  purpose: string;
}

class SubprocessManager {
  private processes: Map<number, TrackedProcess> = new Map();
  private zombieCheckInterval: NodeJS.Timeout | null = null;
  private readonly ZOMBIE_CHECK_INTERVAL_MS = 60000; // 1 minute
  private readonly PROCESS_TIMEOUT_WARNING_MS = 300000; // 5 minutes

  constructor() {
    this.startZombieDetection();
    this.setupShutdownHandlers();
  }

  trackProcess(
    childProcess: ChildProcess,
    script: string,
    type: 'python' | 'led',
    purpose: string
  ): void {
    const pid = childProcess.pid;
    if (!pid) {
      console.warn('[SubprocessManager] Cannot track process without PID');
      return;
    }

    const tracked: TrackedProcess = {
      pid,
      script,
      startTime: Date.now(),
      type,
      purpose,
    };

    this.processes.set(pid, tracked);
    console.log(`[SubprocessManager] Tracking ${type} process PID ${pid}: ${purpose}`);

    childProcess.on('exit', (code, signal) => {
      const elapsed = Date.now() - tracked.startTime;
      console.log(
        `[SubprocessManager] Process PID ${pid} exited after ${elapsed}ms (code: ${code}, signal: ${signal})`
      );
      this.processes.delete(pid);
    });
  }

  async getActiveProcesses(): Promise<TrackedProcess[]> {
    const now = Date.now();
    return Array.from(this.processes.values()).map(p => ({
      ...p,
      duration: now - p.startTime,
    })) as any;
  }

  async detectZombieProcesses(): Promise<void> {
    try {
      const { stdout } = await execAsync('ps aux | grep "python3\\|defunct" | grep -v grep');
      const lines = stdout.trim().split('\n');

      const zombies = lines.filter(line => line.includes('defunct') || line.includes('Z'));

      if (zombies.length > 0) {
        console.warn(
          `[SubprocessManager] ⚠️ Detected ${zombies.length} zombie processes:`
        );
        zombies.forEach(z => console.warn(`  ${z}`));

        zombies.forEach(line => {
          const parts = line.trim().split(/\s+/);
          if (parts[1]) {
            const pid = parseInt(parts[1]);
            try {
              process.kill(pid, 'SIGKILL');
              console.log(`[SubprocessManager] Killed zombie process PID ${pid}`);
            } catch (error) {
              console.error(`[SubprocessManager] Failed to kill zombie PID ${pid}:`, error);
            }
          }
        });
      }
    } catch (error: any) {
      if (error.code !== 1) {
        console.error('[SubprocessManager] Error detecting zombies:', error);
      }
    }
  }

  private async checkLongRunningProcesses(): Promise<void> {
    const now = Date.now();
    const warnings: string[] = [];

    const entries = Array.from(this.processes.entries());
    for (const [pid, proc] of entries) {
      const elapsed = now - proc.startTime;
      if (elapsed > this.PROCESS_TIMEOUT_WARNING_MS) {
        warnings.push(
          `PID ${pid} (${proc.purpose}) running for ${Math.round(elapsed / 1000)}s`
        );
      }
    }

    if (warnings.length > 0) {
      console.warn('[SubprocessManager] ⚠️ Long-running processes detected:');
      warnings.forEach(w => console.warn(`  ${w}`));
    }
  }

  private startZombieDetection(): void {
    console.log(
      `[SubprocessManager] Starting zombie detection (interval: ${this.ZOMBIE_CHECK_INTERVAL_MS}ms)`
    );

    this.zombieCheckInterval = setInterval(async () => {
      await this.detectZombieProcesses();
      await this.checkLongRunningProcesses();
    }, this.ZOMBIE_CHECK_INTERVAL_MS);
  }

  private stopZombieDetection(): void {
    if (this.zombieCheckInterval) {
      clearInterval(this.zombieCheckInterval);
      this.zombieCheckInterval = null;
      console.log('[SubprocessManager] Zombie detection stopped');
    }
  }

  async killAllProcesses(): Promise<void> {
    console.log(
      `[SubprocessManager] Emergency shutdown: killing ${this.processes.size} active processes`
    );

    const entries = Array.from(this.processes.entries());
    for (const [pid, proc] of entries) {
      try {
        console.log(`[SubprocessManager] Killing PID ${pid} (${proc.purpose})`);
        process.kill(pid, 'SIGTERM');

        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
          process.kill(pid, 0);
          console.log(`[SubprocessManager] Force killing PID ${pid}`);
          process.kill(pid, 'SIGKILL');
        } catch {
          console.log(`[SubprocessManager] PID ${pid} already terminated`);
        }
      } catch (error: any) {
        if (error.code !== 'ESRCH') {
          console.error(`[SubprocessManager] Failed to kill PID ${pid}:`, error);
        }
      }
    }

    this.processes.clear();
  }

  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      console.log(`[SubprocessManager] Received ${signal} - cleaning up processes...`);
      this.stopZombieDetection();
      await this.killAllProcesses();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('beforeExit', async () => {
      console.log('[SubprocessManager] Application exiting - cleanup initiated');
      await this.killAllProcesses();
    });
  }

  getProcessCount(): number {
    return this.processes.size;
  }

  getProcessesByType(type: 'python' | 'led'): TrackedProcess[] {
    return Array.from(this.processes.values()).filter(p => p.type === type);
  }
}

export const subprocessManager = new SubprocessManager();

export function spawnTracked(
  command: string,
  args: string[],
  script: string,
  type: 'python' | 'led',
  purpose: string
): ChildProcess {
  const childProcess = spawn(command, args);
  subprocessManager.trackProcess(childProcess, script, type, purpose);
  return childProcess;
}
