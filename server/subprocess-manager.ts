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

  /**
   * Detect and cleanup problematic processes using /proc filesystem inspection
   * Catches STAT=Z (zombie), STAT=D (uninterruptible sleep), and long-running processes
   * More reliable than grep for detecting hung camera processes
   */
  async detectZombieProcesses(): Promise<void> {
    try {
      // Get all python3 processes with their state
      const { stdout } = await execAsync('ps -eo pid,state,cmd | grep python3 | grep -v grep');
      const lines = stdout.trim().split('\n').filter(l => l.trim());

      const problematicProcesses: { pid: number; state: string; cmd: string }[] = [];

      for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
        if (!match) continue;

        const [, pidStr, state, cmd] = match;
        const pid = parseInt(pidStr);
        const stateChar = state[0]; // First char is the main state

        // Detect problematic states:
        // Z = Zombie (defunct)
        // D = Uninterruptible sleep (hung on I/O, can't be killed normally)
        // T = Stopped (suspended)
        if (stateChar === 'Z' || stateChar === 'D' || stateChar === 'T') {
          problematicProcesses.push({ pid, state: stateChar, cmd });
        }
      }

      if (problematicProcesses.length > 0) {
        console.warn(
          `[SubprocessManager] ⚠️ Detected ${problematicProcesses.length} problematic process(es):`
        );
        
        for (const proc of problematicProcesses) {
          console.warn(`  PID ${proc.pid} [${proc.state}]: ${proc.cmd.substring(0, 80)}`);

          // Try escalating kill signals based on state
          try {
            if (proc.state === 'Z') {
              // Zombies are already dead, just need parent to reap
              console.log(`[SubprocessManager] Zombie PID ${proc.pid} - attempting SIGCHLD to parent`);
            } else if (proc.state === 'D') {
              // D-state processes are stuck in kernel, try SIGKILL but may not work
              console.log(`[SubprocessManager] D-state PID ${proc.pid} - attempting SIGKILL (may not work)`);
              process.kill(proc.pid, 'SIGKILL');
              
              // Mark for monitoring - if still alive after 60s, alert
              this.markProcessForEscalation(proc.pid, 'D-state hung process');
            } else {
              // T-state or other - try SIGKILL
              process.kill(proc.pid, 'SIGKILL');
              console.log(`[SubprocessManager] Killed ${proc.state}-state process PID ${proc.pid}`);
            }
          } catch (error: any) {
            if (error.code === 'ESRCH') {
              console.log(`[SubprocessManager] PID ${proc.pid} already gone`);
            } else {
              console.error(`[SubprocessManager] Failed to kill PID ${proc.pid}:`, error.message);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.code !== 1) {
        console.error('[SubprocessManager] Error detecting problematic processes:', error);
      }
    }
  }

  /**
   * Track processes that can't be killed for escalation
   */
  private escalationQueue: Map<number, { reason: string; since: number; attempts: number }> = new Map();

  private markProcessForEscalation(pid: number, reason: string): void {
    const existing = this.escalationQueue.get(pid);
    if (existing) {
      existing.attempts++;
    } else {
      this.escalationQueue.set(pid, { reason, since: Date.now(), attempts: 1 });
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
    const survivingProcesses = new Set<number>();

    for (const [pid, proc] of entries) {
      try {
        console.log(`[SubprocessManager] Killing PID ${pid} (${proc.purpose})`);
        
        // Try SIGTERM first (graceful)
        try {
          process.kill(pid, 'SIGTERM');
        } catch (error: any) {
          if (error.code === 'ESRCH') {
            // Process already gone
            this.processes.delete(pid);
            continue;
          }
        }

        // Wait 2s for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check if still alive
        let isAlive = false;
        try {
          process.kill(pid, 0); // Signal 0 just checks if process exists
          isAlive = true;
        } catch {
          // Process is gone
          this.processes.delete(pid);
          console.log(`[SubprocessManager] ✓ PID ${pid} terminated gracefully`);
          continue;
        }

        if (isAlive) {
          // Force kill with SIGKILL
          console.log(`[SubprocessManager] Force killing PID ${pid}`);
          try {
            process.kill(pid, 'SIGKILL');
          } catch (error: any) {
            if (error.code === 'ESRCH') {
              this.processes.delete(pid);
              continue;
            }
          }

          // Wait 1s and verify
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Final check
          try {
            process.kill(pid, 0);
            // Still alive! Keep in tracking and escalate
            console.error(`[SubprocessManager] ⚠️ CRITICAL: PID ${pid} survived SIGKILL! (likely D-state)`);
            survivingProcesses.add(pid);
            this.markProcessForEscalation(pid, `Survived SIGKILL: ${proc.purpose}`);
          } catch {
            // Finally dead
            this.processes.delete(pid);
            console.log(`[SubprocessManager] ✓ PID ${pid} force killed`);
          }
        }
      } catch (error: any) {
        console.error(`[SubprocessManager] Error killing PID ${pid}:`, error);
        // Keep in tracking if we can't confirm it's dead
        survivingProcesses.add(pid);
      }
    }

    if (survivingProcesses.size > 0) {
      console.error(
        `[SubprocessManager] ⚠️ ${survivingProcesses.size} process(es) survived kill attempts:`,
        Array.from(survivingProcesses)
      );
      console.error('[SubprocessManager] These processes remain tracked and will be retried');
    } else {
      console.log('[SubprocessManager] All processes terminated successfully');
    }
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

  /**
   * Kill all tracked processes matching a specific purpose
   * Safer than pkill - only kills PIDs we spawned
   */
  async killByPurpose(purpose: string): Promise<number> {
    const matchingProcesses = Array.from(this.processes.entries()).filter(
      ([, proc]) => proc.purpose.includes(purpose)
    );

    if (matchingProcesses.length === 0) {
      return 0;
    }

    console.log(`[SubprocessManager] Killing ${matchingProcesses.length} process(es) matching purpose: ${purpose}`);
    let killedCount = 0;

    for (const [pid, proc] of matchingProcesses) {
      try {
        // Try SIGTERM first
        process.kill(pid, 'SIGTERM');
        
        // Wait 1s for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check if still alive
        try {
          process.kill(pid, 0);
          // Still alive, force kill
          process.kill(pid, 'SIGKILL');
          console.log(`[SubprocessManager] Force killed PID ${pid} (${proc.purpose})`);
        } catch {
          // Process is gone
        }
        
        this.processes.delete(pid);
        killedCount++;
        console.log(`[SubprocessManager] Killed PID ${pid} (${proc.purpose})`);
      } catch (error: any) {
        if (error.code === 'ESRCH') {
          // Already dead
          this.processes.delete(pid);
          killedCount++;
        } else {
          console.error(`[SubprocessManager] Failed to kill PID ${pid}:`, error.message);
        }
      }
    }

    return killedCount;
  }

  /**
   * Kill all tracked Python processes (camera-related)
   * Also cleans up orphaned processes from prior runs and releases device locks
   */
  async killAllCameraProcesses(): Promise<void> {
    console.log('[SubprocessManager] Killing all camera-related Python processes...');
    
    // Step 1: Kill all tracked processes
    let totalKilled = 0;
    totalKilled += await this.killByPurpose('aruco_calibrator');
    totalKilled += await this.killByPurpose('camera_preview');
    totalKilled += await this.killByPurpose('validate_slot');
    totalKilled += await this.killByPurpose('rectified_preview');
    totalKilled += await this.killByPurpose('scheduled_capture');
    
    console.log(`[SubprocessManager] Killed ${totalKilled} tracked process(es)`);
    
    // Step 2: Always clean up orphaned processes from prior runs
    // This handles processes that were running before a service restart
    const scripts = [
      'aruco_calibrator.py',
      'camera_preview.py',
      'validate_slot_qrs.py',
      'rectified_preview.py',
      'scheduled_capture.py'
    ];
    
    for (const script of scripts) {
      try {
        // Use targeted pkill with exact script name match
        await execAsync(`pkill -9 -f "${script}" 2>/dev/null || true`);
      } catch {
        // Ignore errors - process may not exist
      }
    }
    
    // Step 3: Release device locks on common video devices
    // This handles stale file handles that may persist after process death
    try {
      await execAsync('fuser -k /dev/video0 /dev/video1 /dev/video2 2>/dev/null || true');
    } catch {
      // Ignore errors - devices may not be in use
    }
    
    // Wait for device release
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('[SubprocessManager] Camera process cleanup complete');
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
