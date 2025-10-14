import cron from 'node-cron';
import { format, toZonedTime } from 'date-fns-tz';
import type { IStorage } from './storage';
import { spawn } from 'child_process';
import type { Camera, Slot } from '@shared/schema';
import { sendAlertEmail } from './services/email-alerts';
import { SheetsLogger } from './services/sheets-logger';

const TIMEZONE = 'Asia/Tokyo';

interface SchedulerConfig {
  captureTimes: string[]; // Array of time strings in HH:mm format
  timezone: string;
  schedulerPaused: boolean;
}

export class CaptureScheduler {
  private storage: IStorage;
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private diagnosticTasks: Map<string, cron.ScheduledTask> = new Map();
  private isInitialized = false;
  private sheetsLogger: SheetsLogger;

  constructor(storage: IStorage) {
    this.storage = storage;
    this.sheetsLogger = new SheetsLogger(storage);
  }

  /**
   * Load scheduler configuration from database
   */
  private async loadConfig(): Promise<SchedulerConfig> {
    const captureTimesConfig = await this.storage.getConfigByKey('capture_times');
    const timezoneConfig = await this.storage.getConfigByKey('timezone');
    const pausedConfig = await this.storage.getConfigByKey('scheduler_paused');

    return {
      captureTimes: captureTimesConfig?.value as string[] || ['08:00', '11:00', '14:00', '17:00'],
      timezone: timezoneConfig?.value as string || TIMEZONE,
      schedulerPaused: pausedConfig?.value as boolean || false,
    };
  }

  /**
   * Initialize scheduler with default config if not exists
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('[Scheduler] Already initialized');
      return;
    }

    console.log('[Scheduler] Initializing...');

    // Ensure default config exists
    const captureTimesConfig = await this.storage.getConfigByKey('capture_times');
    if (!captureTimesConfig) {
      await this.storage.setConfig(
        'capture_times',
        ['08:00', '11:00', '14:00', '17:00'],
        'Scheduled capture times in HH:mm format (JST)'
      );
    }

    const timezoneConfig = await this.storage.getConfigByKey('timezone');
    if (!timezoneConfig) {
      await this.storage.setConfig(
        'timezone',
        TIMEZONE,
        'Timezone for scheduled captures'
      );
    }

    const pausedConfig = await this.storage.getConfigByKey('scheduler_paused');
    if (!pausedConfig) {
      await this.storage.setConfig(
        'scheduler_paused',
        false,
        'Whether scheduler is paused'
      );
    }

    // Initialize sheets logger
    await this.sheetsLogger.initialize();

    this.isInitialized = true;
    await this.reload();
    console.log('[Scheduler] Initialized successfully');
  }

  /**
   * Reload scheduler configuration and update cron jobs
   */
  async reload() {
    console.log('[Scheduler] Reloading configuration...');
    
    const config = await this.loadConfig();

    // Stop all existing tasks
    this.stopAll();

    // Don't schedule if paused
    if (config.schedulerPaused) {
      console.log('[Scheduler] Paused - no tasks scheduled');
      return;
    }

    // Schedule capture tasks for each time
    for (const timeStr of config.captureTimes) {
      this.scheduleCapture(timeStr);
      this.scheduleDiagnostic(timeStr); // 30 min before capture
    }

    console.log(`[Scheduler] Scheduled ${config.captureTimes.length} capture times`);
  }

  /**
   * Schedule a capture at a specific time (JST)
   */
  private scheduleCapture(timeStr: string) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // Cron expression: minute hour * * *
    const cronExpression = `${minutes} ${hours} * * *`;

    const task = cron.schedule(cronExpression, async () => {
      console.log(`[Scheduler] Running scheduled capture at ${timeStr} JST`);
      await this.executeCapture('scheduled');
    }, {
      timezone: TIMEZONE
    });

    this.tasks.set(`capture-${timeStr}`, task);
    console.log(`[Scheduler] Scheduled capture at ${timeStr} JST (${cronExpression})`);
  }

  /**
   * Schedule a diagnostic check 30 minutes before capture time
   */
  private scheduleDiagnostic(timeStr: string) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // Calculate time 30 minutes before
    let diagHours = hours;
    let diagMinutes = minutes - 30;
    
    if (diagMinutes < 0) {
      diagMinutes += 60;
      diagHours -= 1;
      if (diagHours < 0) {
        diagHours += 24;
      }
    }

    const cronExpression = `${diagMinutes} ${diagHours} * * *`;

    const task = cron.schedule(cronExpression, async () => {
      console.log(`[Scheduler] Running pre-flight diagnostic for ${timeStr} capture`);
      await this.executeDiagnostic();
    }, {
      timezone: TIMEZONE
    });

    this.diagnosticTasks.set(`diagnostic-${timeStr}`, task);
    console.log(`[Scheduler] Scheduled diagnostic at ${diagHours}:${diagMinutes.toString().padStart(2, '0')} JST (${cronExpression})`);
  }

  /**
   * Execute capture process
   */
  private async executeCapture(triggerType: 'scheduled' | 'manual'): Promise<any> {
    const startTime = Date.now();

    try {
      console.log(`[Scheduler] Starting ${triggerType} capture...`);

      // Get all active cameras
      const allCameras = await this.storage.getCameras();
      const activeCameras = allCameras.filter(c => c.isActive);

      // Get all slots grouped by camera
      const allSlots = await this.storage.getSlots();
      const slotsByCamera: Record<string, Slot[]> = {};
      
      for (const slot of allSlots) {
        if (!slotsByCamera[slot.cameraId]) {
          slotsByCamera[slot.cameraId] = [];
        }
        slotsByCamera[slot.cameraId].push(slot);
      }

      // Prepare data for Python script
      const inputData = {
        cameras: activeCameras,
        slotsByCamera,
      };

      // Execute Python script
      const result = await this.runPythonScript('python/process_cameras.py', inputData);

      const executionTime = Date.now() - startTime;

      // Create capture run record
      await this.storage.createCaptureRun({
        triggerType,
        camerasCaptured: result.camerasCaptured || 0,
        slotsProcessed: result.slotsProcessed || 0,
        failureCount: result.failureCount || 0,
        status: result.status,
        errorMessages: result.results?.flatMap((r: any) => r.errors || []) || [],
        executionTimeMs: executionTime,
      });

      // Log to Google Sheets
      try {
        const now = toZonedTime(new Date(), TIMEZONE);
        const timestamp = format(now, 'yyyy-MM-dd HH:mm:ss', { timeZone: TIMEZONE });
        await this.sheetsLogger.logCapture({
          timestamp,
          triggerType,
          camerasCaptured: result.camerasCaptured || 0,
          slotsProcessed: result.slotsProcessed || 0,
          failureCount: result.failureCount || 0,
          status: result.status,
          executionTimeMs: executionTime,
        });
      } catch (error) {
        console.error('[Scheduler] Failed to log to sheets:', error);
      }

      // Create detection logs for each slot result
      if (result.results) {
        for (const cameraResult of result.results) {
          if (cameraResult.slotResults) {
            for (const slotResult of cameraResult.slotResults) {
              await this.storage.createDetectionLog({
                slotId: slotResult.slotId,
                status: slotResult.status,
                qrId: slotResult.qrData,
                ssimScore: slotResult.ssimEmpty, // Store empty baseline SSIM
                rawDetectionData: slotResult,
                alertTriggered: false, // TODO: Implement alert logic
              });
            }
          }
        }
      }

      // If there were failures, trigger alert
      if (result.status === 'failure' || result.status === 'partial_failure') {
        await this.sendAlert('CAPTURE_FAILURE', `Capture ${result.status}: ${result.failureCount} failures`);
      }

      console.log(`[Scheduler] Capture complete: ${result.status} (${executionTime}ms)`);
      return result;

    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      
      console.error('[Scheduler] Capture error:', error);

      // Create failed capture run record
      await this.storage.createCaptureRun({
        triggerType,
        camerasCaptured: 0,
        slotsProcessed: 0,
        failureCount: 1,
        status: 'failure',
        errorMessages: [error.message || 'Unknown error'],
        executionTimeMs: executionTime,
      });

      await this.sendAlert('CAPTURE_ERROR', `Capture failed: ${error.message}`);

      throw error;
    }
  }

  /**
   * Execute diagnostic check
   */
  private async executeDiagnostic(): Promise<any> {
    const startTime = Date.now();

    try {
      console.log('[Scheduler] Starting diagnostic check...');

      // Get all active cameras
      const allCameras = await this.storage.getCameras();
      const activeCameras = allCameras.filter(c => c.isActive);

      // Execute Python diagnostic script
      const result = await this.runPythonScript('python/camera_diagnostic.py', activeCameras);

      const executionTime = Date.now() - startTime;

      // Create diagnostic run record
      const diagnosticStatus = result.status === 'healthy' ? 'success' : (result.status === 'warning' ? 'partial_failure' : 'failure');
      await this.storage.createCaptureRun({
        triggerType: 'diagnostic',
        camerasCaptured: result.healthy || 0,
        slotsProcessed: 0,
        failureCount: result.failed || 0,
        status: diagnosticStatus,
        errorMessages: result.results?.flatMap((r: any) => r.errors || []) || [],
        executionTimeMs: executionTime,
      });

      // Log to Google Sheets
      try {
        const now = toZonedTime(new Date(), TIMEZONE);
        const timestamp = format(now, 'yyyy-MM-dd HH:mm:ss', { timeZone: TIMEZONE });
        await this.sheetsLogger.logCapture({
          timestamp,
          triggerType: 'diagnostic',
          camerasCaptured: result.healthy || 0,
          slotsProcessed: 0,
          failureCount: result.failed || 0,
          status: diagnosticStatus,
          executionTimeMs: executionTime,
        });
      } catch (error) {
        console.error('[Scheduler] Failed to log diagnostic to sheets:', error);
      }

      // If there are failures or warnings, send alert
      if (result.status === 'failed' || result.status === 'warning') {
        const failedCameras = result.results?.filter((r: any) => r.status === 'failed') || [];
        const warningCameras = result.results?.filter((r: any) => r.status === 'warning') || [];
        
        let message = 'Pre-flight diagnostic detected issues:\n';
        
        if (failedCameras.length > 0) {
          message += `\nFailed cameras (${failedCameras.length}):\n`;
          failedCameras.forEach((c: any) => {
            message += `- Camera ${c.cameraId}: ${c.errors.join(', ')}\n`;
          });
        }
        
        if (warningCameras.length > 0) {
          message += `\nWarning cameras (${warningCameras.length}):\n`;
          warningCameras.forEach((c: any) => {
            message += `- Camera ${c.cameraId}: ${c.warnings.join(', ')}\n`;
          });
        }

        await this.sendAlert('DIAGNOSTIC_FAILURE', message);
      }

      console.log(`[Scheduler] Diagnostic complete: ${result.status} (${executionTime}ms)`);
      return result;

    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      
      console.error('[Scheduler] Diagnostic error:', error);

      // Create failed diagnostic run record
      await this.storage.createCaptureRun({
        triggerType: 'diagnostic',
        camerasCaptured: 0,
        slotsProcessed: 0,
        failureCount: 1,
        status: 'failure',
        errorMessages: [error.message || 'Unknown error'],
        executionTimeMs: executionTime,
      });

      await this.sendAlert('DIAGNOSTIC_ERROR', `Diagnostic check failed: ${error.message}`);

      throw error;
    }
  }

  /**
   * Run Python script with input data via stdin
   */
  private runPythonScript(scriptPath: string, inputData: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const python = spawn('python3', [scriptPath]);
      
      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0 && code !== 2) { // 0 = success, 2 = warning
          reject(new Error(`Python script exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse Python output: ${stdout}`));
        }
      });

      python.on('error', (error) => {
        reject(new Error(`Failed to spawn Python process: ${error.message}`));
      });

      // Send input data via stdin
      python.stdin.write(JSON.stringify(inputData));
      python.stdin.end();
    });
  }

  /**
   * Send alert notification via email and log to Google Sheets
   */
  private async sendAlert(alertType: string, message: string) {
    try {
      console.log(`[Scheduler] Sending alert: ${alertType}`);
      
      const now = toZonedTime(new Date(), TIMEZONE);
      const timestamp = format(now, 'yyyy-MM-dd HH:mm:ss', { timeZone: TIMEZONE });
      
      let emailType: 'diagnostic_failure' | 'capture_failure' | 'camera_offline' | 'test_alert';
      let subject: string;
      
      if (alertType === 'DIAGNOSTIC_FAILURE' || alertType === 'DIAGNOSTIC_ERROR') {
        emailType = 'diagnostic_failure';
        subject = '⚠️ Tool Tracker - Diagnostic Check Failed';
      } else if (alertType === 'CAPTURE_FAILURE' || alertType === 'CAPTURE_ERROR') {
        emailType = 'capture_failure';
        subject = '🚨 Tool Tracker - Capture Failed';
      } else {
        emailType = 'camera_offline';
        subject = '📷 Tool Tracker - Camera Alert';
      }
      
      // Send email
      await sendAlertEmail({
        type: emailType,
        subject,
        details: {
          timestamp,
          errorMessage: message
        }
      });
      
      // Log to Google Sheets
      try {
        await this.sheetsLogger.logAlert({
          timestamp,
          alertType,
          status: 'sent',
          errorMessage: message,
        });
      } catch (sheetsError) {
        console.error('[Scheduler] Failed to log alert to sheets:', sheetsError);
      }
      
      console.log(`[Scheduler] Alert sent successfully: ${alertType}`);
    } catch (error) {
      console.error('[Scheduler] Failed to send alert:', error);
    }
  }

  /**
   * Manually trigger capture
   */
  async triggerCaptureNow(): Promise<any> {
    console.log('[Scheduler] Manual capture triggered');
    return this.executeCapture('manual');
  }

  /**
   * Manually trigger diagnostic
   */
  async triggerDiagnosticNow(): Promise<any> {
    console.log('[Scheduler] Manual diagnostic triggered');
    return this.executeDiagnostic();
  }

  /**
   * Stop all scheduled tasks
   */
  stopAll() {
    this.tasks.forEach((task, key) => {
      task.stop();
      console.log(`[Scheduler] Stopped task: ${key}`);
    });
    this.tasks.clear();

    this.diagnosticTasks.forEach((task, key) => {
      task.stop();
      console.log(`[Scheduler] Stopped diagnostic task: ${key}`);
    });
    this.diagnosticTasks.clear();
  }

  /**
   * Get next scheduled run times
   */
  async getNextRuns(): Promise<{ capture: string[], diagnostic: string[] }> {
    const config = await this.loadConfig();
    
    if (config.schedulerPaused) {
      return { capture: [], diagnostic: [] };
    }

    const now = toZonedTime(new Date(), TIMEZONE);
    const capture: string[] = [];
    const diagnostic: string[] = [];

    for (const timeStr of config.captureTimes) {
      const [hours, minutes] = timeStr.split(':').map(Number);
      
      const captureTime = new Date(now);
      captureTime.setHours(hours, minutes, 0, 0);
      
      // If time has passed today, show tomorrow's time
      if (captureTime <= now) {
        captureTime.setDate(captureTime.getDate() + 1);
      }

      capture.push(format(toZonedTime(captureTime, TIMEZONE), 'yyyy-MM-dd HH:mm:ss zzz', { timeZone: TIMEZONE }));

      // Diagnostic is 30 min before
      const diagTime = new Date(captureTime);
      diagTime.setMinutes(diagTime.getMinutes() - 30);
      diagnostic.push(format(toZonedTime(diagTime, TIMEZONE), 'yyyy-MM-dd HH:mm:ss zzz', { timeZone: TIMEZONE }));
    }

    return { capture, diagnostic };
  }

  /**
   * Get Google Sheets URL for alert logs
   */
  getSheetsUrl(): string | null {
    return this.sheetsLogger.getSpreadsheetUrl();
  }
}
