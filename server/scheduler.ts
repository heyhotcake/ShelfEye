import cron from 'node-cron';
import { format, toZonedTime } from 'date-fns-tz';
import type { IStorage } from './storage';
import { spawn } from 'child_process';
import type { Camera, Slot } from '@shared/schema';
import { sendAlertEmail } from './services/email-alerts';
import { SheetsLogger } from './services/sheets-logger';
import { getAlertLEDController } from './services/alert-led';
import { maintenanceService } from './services/maintenance-service';
import { cameraSessionManager } from './camera-session-manager';
import { subprocessManager } from './subprocess-manager';

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
  
  private readonly CAPTURE_TIMEOUT_MS = 600000; // 10 minutes

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

    // Initialize default alert message templates
    const alertTemplatesConfig = await this.storage.getConfigByKey('ALERT_TEMPLATES');
    if (!alertTemplatesConfig) {
      await this.storage.setConfig(
        'ALERT_TEMPLATES',
        {
          diagnostic_failure: {
            subject: '⚠️ Tool Tracker - Diagnostic Check Failed',
            emailBody: 'Pre-flight diagnostic check failed at {timestamp}.\n\nDetails:\n{errorMessage}\n\nPlease check the cameras before the next scheduled capture.',
            sheetsMessage: 'Diagnostic check failed: {errorMessage}'
          },
          capture_failure: {
            subject: '🚨 Tool Tracker - Capture Failed',
            emailBody: 'Scheduled capture failed at {timestamp}.\n\nDetails:\n{errorMessage}\n\nImmediate attention required.',
            sheetsMessage: 'Capture failed: {errorMessage}'
          },
          camera_offline: {
            subject: '📷 Tool Tracker - Camera Alert',
            emailBody: 'Camera health issue detected at {timestamp}.\n\nDetails:\n{errorMessage}',
            sheetsMessage: 'Camera issue: {errorMessage}'
          },
          test_alert: {
            subject: '✅ Tool Tracker - Test Alert',
            emailBody: 'This is a test alert from Tool Tracker at {timestamp}.\n\nIf you received this, your alert system is working correctly.',
            sheetsMessage: 'Test alert sent successfully'
          }
        },
        'Alert message templates with placeholders: {timestamp}, {errorMessage}, {cameraId}, {slotId}'
      );
    }

    // Initialize Google Sheets formatting configuration
    const sheetsConfigData = await this.storage.getConfigByKey('SHEETS_FORMATTING');
    if (!sheetsConfigData) {
      await this.storage.setConfig(
        'SHEETS_FORMATTING',
        {
          tabCreation: 'monthly', // monthly, weekly, daily, single
          tabNamePattern: 'Alerts-{YYYY-MM}', // {YYYY}, {MM}, {DD}, {WW} (week number)
          columnOrder: ['timestamp', 'alertType', 'status', 'cameraId', 'slotId', 'errorMessage', 'details'],
          includeHeaders: true,
          freezeHeaderRow: true,
          autoResize: true
        },
        'Google Sheets formatting configuration for alert logs'
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

    // Schedule daily maintenance at 3 AM JST
    this.scheduleDailyMaintenance();

    console.log(`[Scheduler] Scheduled ${config.captureTimes.length} capture times + daily maintenance`);
  }

  /**
   * Schedule daily maintenance task
   * Runs at 3 AM JST to clean up old data and check disk space
   */
  private scheduleDailyMaintenance() {
    // Cron: 0 3 * * * = 3:00 AM every day
    const task = cron.schedule('0 3 * * *', async () => {
      console.log('[Scheduler] Running daily maintenance at 3:00 AM JST');
      try {
        await maintenanceService.runDailyMaintenance();
      } catch (error) {
        console.error('[Scheduler] Daily maintenance failed:', error);
      }
    }, {
      timezone: TIMEZONE
    });

    this.tasks.set('daily-maintenance', task);
    console.log('[Scheduler] Scheduled daily maintenance at 3:00 AM JST');
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

      // Get light strip GPIO pin from config
      const lightStripPin = await this.storage.getConfigByKey('light_strip_gpio_pin');
      
      // Prepare data for Python script
      const inputData = {
        cameras: activeCameras,
        slotsByCamera,
        lightStripPin: lightStripPin ? parseInt(lightStripPin.value as string) : null,
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

      // If there were failures, trigger alert with detailed camera information
      if (result.status === 'failure' || result.status === 'partial_failure') {
        const failedCameras = result.results?.filter((r: any) => r.status === 'failed') || [];
        const successCameras = result.results?.filter((r: any) => r.status === 'success') || [];
        
        let message = `Capture ${result.status}: ${result.failureCount}/${result.results?.length || 0} cameras failed`;
        
        if (failedCameras.length > 0) {
          message += '\n\nFailed cameras:\n';
          failedCameras.forEach((cam: any) => {
            const errors = cam.errors?.join(', ') || 'Unknown error';
            message += `• ${cam.cameraId}: ${errors}\n`;
          });
        }
        
        if (result.status === 'partial_failure' && successCameras.length > 0) {
          message += `\n✓ ${successCameras.length} camera(s) succeeded (${result.slotsProcessed} slots processed)`;
        }
        
        // Use first failed camera ID for alert reference
        const failedCameraId = failedCameras[0]?.cameraId;
        await this.sendAlert('capture_failure', message, failedCameraId);
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

      await this.sendAlert('capture_failure', `Capture failed: ${error.message}`);

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

        // Pass first failed camera for alert identification (if multi-camera, at least shows one camera)
        const firstFailedCameraId = failedCameras.length > 0 ? failedCameras[0].cameraId : warningCameras[0]?.cameraId;
        await this.sendAlert('diagnostic_failure', message, firstFailedCameraId);
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

      await this.sendAlert('diagnostic_failure', `Diagnostic check failed: ${error.message}`);

      throw error;
    }
  }

  /**
   * Run Python script with input data via stdin, with timeout protection
   * Kills process and alerts if it exceeds CAPTURE_TIMEOUT_MS (10 minutes)
   */
  private runPythonScript(scriptPath: string, inputData: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const python = spawn('python3', [scriptPath]);
      const pid = python.pid;
      const startTime = Date.now();
      
      let stdout = '';
      let stderr = '';
      let isTimedOut = false;
      let isSettled = false;

      // Track this process using centralized subprocess manager
      subprocessManager.trackProcess(python, scriptPath, 'python', 'scheduled_capture');

      // Timeout handler - kills process after CAPTURE_TIMEOUT_MS
      const timeoutHandle = setTimeout(() => {
        if (!isSettled && python.pid) {
          isTimedOut = true;
          isSettled = true;
          const elapsed = Date.now() - startTime;
          console.error(`[Scheduler] ⚠️ Process timeout after ${elapsed}ms - killing PID ${python.pid}`);
          
          try {
            // Try graceful termination first
            python.kill('SIGTERM');
            
            // Force kill after 5 seconds if SIGTERM didn't work and process is still alive
            setTimeout(() => {
              // Only SIGKILL if process hasn't exited yet (exitCode is null when still running)
              if (python.exitCode === null) {
                try {
                  python.kill('SIGKILL');
                  console.error(`[Scheduler] Force killed unresponsive process PID ${python.pid}`);
                } catch (err: any) {
                  // ESRCH means process already died - that's fine
                  if (err.code !== 'ESRCH') {
                    console.error(`[Scheduler] SIGKILL failed for PID ${python.pid}:`, err);
                  }
                }
              } else {
                console.log(`[Scheduler] Process PID ${python.pid} exited after SIGTERM - SIGKILL not needed`);
              }
            }, 5000);
          } catch (killError) {
            console.error(`[Scheduler] Failed to send SIGTERM to process ${python.pid}:`, killError);
          }

          // Reject the promise immediately - don't wait for close event
          reject(new Error(`Capture timeout after ${elapsed}ms (exceeded ${this.CAPTURE_TIMEOUT_MS}ms limit)`));
        }
      }, this.CAPTURE_TIMEOUT_MS);

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        clearTimeout(timeoutHandle);
        
        const elapsed = Date.now() - startTime;
        console.log(`[Scheduler] Python process exited after ${elapsed}ms (code: ${code})`);

        // If promise already settled (timeout or error), don't try to settle again
        if (isSettled) {
          console.log(`[Scheduler] Process completed after timeout/error - ignoring close event`);
          return;
        }

        isSettled = true;

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
        clearTimeout(timeoutHandle);

        if (!isSettled) {
          isSettled = true;
          reject(new Error(`Failed to spawn Python process: ${error.message}`));
        }
      });

      // Send input data via stdin
      try {
        python.stdin.write(JSON.stringify(inputData));
        python.stdin.end();
      } catch (stdinError) {
        console.error(`[Scheduler] Failed to write to stdin:`, stdinError);
        clearTimeout(timeoutHandle);
        if (!isSettled) {
          isSettled = true;
          reject(new Error(`Failed to write input data: ${stdinError}`));
        }
      }
    });
  }

  /**
   * Send alert notification via email and log to Google Sheets using configurable templates
   */
  private async sendAlert(alertType: string, message: string, cameraId?: string, slotId?: string) {
    try {
      console.log(`[Scheduler] Sending alert: ${alertType}`);
      
      const now = toZonedTime(new Date(), TIMEZONE);
      const timestamp = format(now, 'yyyy-MM-dd HH:mm:ss', { timeZone: TIMEZONE });
      
      // Fetch camera name if cameraId is provided (critical for multi-camera identification)
      let cameraName: string | undefined;
      if (cameraId) {
        try {
          const camera = await this.storage.getCamera(cameraId);
          cameraName = camera?.name;
          if (cameraName) {
            console.log(`[Scheduler] Alert for camera: ${cameraName} (${cameraId})`);
          }
        } catch (error) {
          console.warn(`[Scheduler] Failed to fetch camera name for ${cameraId}:`, error);
        }
      }
      
      // Normalize alert type (support both legacy uppercase and new lowercase)
      let emailType: 'diagnostic_failure' | 'capture_failure' | 'camera_offline' | 'test_alert';
      
      // Handle legacy uppercase formats for backward compatibility
      if (alertType === 'DIAGNOSTIC_FAILURE' || alertType === 'DIAGNOSTIC_ERROR' || alertType === 'diagnostic_failure') {
        emailType = 'diagnostic_failure';
      } else if (alertType === 'CAPTURE_FAILURE' || alertType === 'CAPTURE_ERROR' || alertType === 'capture_failure') {
        emailType = 'capture_failure';
      } else if (alertType === 'camera_offline') {
        emailType = 'camera_offline';
      } else if (alertType === 'test_alert') {
        emailType = 'test_alert';
      } else {
        // Unknown type - log warning and default to camera_offline
        console.warn(`[Scheduler] ⚠️ Unknown alert type '${alertType}' - defaulting to 'camera_offline'`);
        console.warn(`[Scheduler] Valid types: diagnostic_failure, capture_failure, camera_offline, test_alert`);
        emailType = 'camera_offline';
      }
      
      // Get alert templates from configuration
      const templatesConfig = await this.storage.getConfigByKey('ALERT_TEMPLATES');
      const templates = templatesConfig?.value as Record<string, { subject: string; emailBody: string; sheetsMessage: string }> || {};
      const template = templates[emailType] || {
        subject: 'Tool Tracker Alert',
        emailBody: '{errorMessage}',
        sheetsMessage: '{errorMessage}'
      };
      
      // Substitute placeholders
      const substitutions: Record<string, string> = {
        '{timestamp}': timestamp,
        '{errorMessage}': message,
        '{cameraId}': cameraId || 'N/A',
        '{cameraName}': cameraName || 'Unknown Camera',
        '{slotId}': slotId || 'N/A'
      };
      
      const substituteTemplate = (text: string) => {
        let result = text;
        for (const [placeholder, value] of Object.entries(substitutions)) {
          result = result.replace(new RegExp(placeholder, 'g'), value);
        }
        return result;
      };
      
      const subject = substituteTemplate(template.subject);
      const emailBody = substituteTemplate(template.emailBody);
      const sheetsMessage = substituteTemplate(template.sheetsMessage);
      
      // Send email with camera identification
      await sendAlertEmail({
        type: emailType,
        subject,
        details: {
          timestamp,
          errorMessage: emailBody,
          cameraId,
          cameraName
        }
      });
      
      // Log to Google Sheets with camera identification
      try {
        await this.sheetsLogger.logAlert({
          timestamp,
          alertType,
          status: 'sent',
          errorMessage: sheetsMessage,
          cameraId,
          cameraName,
          slotId
        });
      } catch (sheetsError) {
        console.error('[Scheduler] Failed to log alert to sheets:', sheetsError);
      }
      
      // Flash alert LED
      try {
        const alertLED = getAlertLEDController(this.storage);
        await alertLED.startFlash('fast');
        console.log('[Scheduler] Alert LED activated');
      } catch (ledError) {
        console.error('[Scheduler] Failed to activate alert LED:', ledError);
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
