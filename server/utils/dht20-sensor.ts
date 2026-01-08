import { spawn, ChildProcess } from "child_process";
import path from "path";

interface DHT20Reading {
  ok: boolean;
  temperature_c?: number;
  temperature_f?: number;
  humidity?: number;
  timestamp?: number;
  error?: string;
}

const PYTHON_SCRIPT = path.join(process.cwd(), "python", "dht20_sensor.py");
const TIMEOUT_MS = 10000;

export async function readDHT20(): Promise<DHT20Reading> {
  return new Promise((resolve) => {
    let python: ChildProcess | null = null;
    let killed = false;
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      if (python && !killed) {
        killed = true;
        python.kill("SIGTERM");
        setTimeout(() => {
          if (python && !python.killed) {
            python.kill("SIGKILL");
          }
        }, 1000);
        resolve({
          ok: false,
          error: "Sensor read timeout (10s)",
        });
      }
    }, TIMEOUT_MS);

    try {
      python = spawn("python3", [PYTHON_SCRIPT, "--json"]);

      python.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      python.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      python.on("close", (code) => {
        clearTimeout(timeout);
        if (killed) return;

        if (code !== 0) {
          resolve({
            ok: false,
            error: stderr || `Process exited with code ${code}`,
          });
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          resolve({
            ok: false,
            error: `Failed to parse output: ${stdout}`,
          });
        }
      });

      python.on("error", (err) => {
        clearTimeout(timeout);
        if (killed) return;
        resolve({
          ok: false,
          error: `Failed to spawn process: ${err.message}`,
        });
      });
    } catch (err) {
      clearTimeout(timeout);
      resolve({
        ok: false,
        error: `Spawn error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}
