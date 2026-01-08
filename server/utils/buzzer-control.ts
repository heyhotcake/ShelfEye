import { spawn } from 'child_process';
import path from 'path';

const PYTHON_SCRIPT = path.join(process.cwd(), 'python', 'buzzer_control.py');
const TIMEOUT_MS = 10000;

interface BuzzerResult {
  ok: boolean;
  state?: string;
  beeps?: number;
  error?: string;
}

async function executeBuzzerCommand(command: string, args: string[] = []): Promise<BuzzerResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeout = setTimeout(() => {
      if (!killed) {
        killed = true;
        python.kill('SIGTERM');
        resolve({ ok: false, error: 'Command timeout' });
      }
    }, TIMEOUT_MS);

    const python = spawn('sudo', ['python3', PYTHON_SCRIPT, command, '--json', ...args]);

    python.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      clearTimeout(timeout);
      if (killed) return;

      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        resolve({ ok: false, error: stderr || `Exit code ${code}` });
      }
    });

    python.on('error', (err) => {
      clearTimeout(timeout);
      if (killed) return;
      resolve({ ok: false, error: `Spawn error: ${err.message}` });
    });
  });
}

export async function buzzerOn(): Promise<boolean> {
  const result = await executeBuzzerCommand('on');
  if (result.ok) {
    console.log('[Buzzer] ON');
  } else {
    console.error('[Buzzer] Failed to turn on:', result.error);
  }
  return result.ok;
}

export async function buzzerOff(): Promise<boolean> {
  const result = await executeBuzzerCommand('off');
  if (result.ok) {
    console.log('[Buzzer] OFF');
  } else {
    console.error('[Buzzer] Failed to turn off:', result.error);
  }
  return result.ok;
}

export async function buzzerBeep(durationMs = 500, count = 3, intervalMs = 200): Promise<boolean> {
  const result = await executeBuzzerCommand('beep', [
    '--duration', durationMs.toString(),
    '--count', count.toString(),
    '--interval', intervalMs.toString()
  ]);
  if (result.ok) {
    console.log(`[Buzzer] Beeped ${count} times`);
  } else {
    console.error('[Buzzer] Failed to beep:', result.error);
  }
  return result.ok;
}

export async function alertBuzzer(): Promise<boolean> {
  return buzzerBeep(500, 5, 300);
}
