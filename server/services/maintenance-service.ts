import { db } from "../db";
import { detectionLogs, alertQueue } from "@shared/schema";
import { sql } from "drizzle-orm";
import * as fs from "fs/promises";
import type { Stats } from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface DiskUsage {
  total: number;
  used: number;
  free: number;
  percentUsed: number;
}

export class MaintenanceService {
  private static instance: MaintenanceService;
  private cleanupRunning = false;

  private constructor() {}

  static getInstance(): MaintenanceService {
    if (!MaintenanceService.instance) {
      MaintenanceService.instance = new MaintenanceService();
    }
    return MaintenanceService.instance;
  }

  /**
   * Delete detection logs older than specified days
   */
  async cleanupOldLogs(retentionDays: number): Promise<number> {
    try {
      console.log(`[Maintenance] Cleaning up detection logs older than ${retentionDays} days`);
      
      const result = await db
        .delete(detectionLogs)
        .where(sql`timestamp < NOW() - INTERVAL '${sql.raw(retentionDays.toString())} days'`);
      
      const deletedCount = result.rowCount || 0;
      console.log(`[Maintenance] Deleted ${deletedCount} old detection log entries`);
      
      return deletedCount;
    } catch (error) {
      console.error('[Maintenance] Error cleaning up logs:', error);
      throw error;
    }
  }

  /**
   * Delete sent alerts older than specified days
   */
  async cleanupOldAlerts(retentionDays: number): Promise<number> {
    try {
      console.log(`[Maintenance] Cleaning up sent alerts older than ${retentionDays} days`);
      
      const result = await db
        .delete(alertQueue)
        .where(sql`status = 'sent' AND sent_at < NOW() - INTERVAL '${sql.raw(retentionDays.toString())} days'`);
      
      const deletedCount = result.rowCount || 0;
      console.log(`[Maintenance] Deleted ${deletedCount} old sent alerts`);
      
      return deletedCount;
    } catch (error) {
      console.error('[Maintenance] Error cleaning up alerts:', error);
      throw error;
    }
  }

  /**
   * Delete ROI images older than specified days
   */
  async cleanupOldImages(retentionDays: number): Promise<{ deletedFiles: number; freedMB: number }> {
    try {
      console.log(`[Maintenance] Cleaning up ROI images older than ${retentionDays} days`);
      
      const roisDir = path.join(process.cwd(), 'data', 'rois');
      
      // Check if directory exists
      try {
        await fs.access(roisDir);
      } catch {
        console.log('[Maintenance] ROIs directory does not exist, skipping image cleanup');
        return { deletedFiles: 0, freedMB: 0 };
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoffTime = cutoffDate.getTime();

      let deletedFiles = 0;
      let freedBytes = 0;

      // Recursively scan ROIs directory
      await this.cleanupDirectory(roisDir, cutoffTime, (stats) => {
        deletedFiles++;
        freedBytes += stats.size;
      });

      const freedMB = Math.round(freedBytes / (1024 * 1024) * 100) / 100;
      console.log(`[Maintenance] Deleted ${deletedFiles} old ROI images, freed ${freedMB} MB`);

      return { deletedFiles, freedMB };
    } catch (error) {
      console.error('[Maintenance] Error cleaning up images:', error);
      throw error;
    }
  }

  /**
   * Recursively clean up old files in a directory
   */
  private async cleanupDirectory(
    dirPath: string,
    cutoffTime: number,
    onDelete: (stats: fs.Stats) => void
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          await this.cleanupDirectory(fullPath, cutoffTime, onDelete);

          // Remove empty directories
          const remainingEntries = await fs.readdir(fullPath);
          if (remainingEntries.length === 0) {
            await fs.rmdir(fullPath);
            console.log(`[Maintenance] Removed empty directory: ${fullPath}`);
          }
        } else if (entry.isFile()) {
          // Check file age
          const stats = await fs.stat(fullPath);
          if (stats.mtime.getTime() < cutoffTime) {
            await fs.unlink(fullPath);
            onDelete(stats);
          }
        }
      }
    } catch (error) {
      console.error(`[Maintenance] Error cleaning directory ${dirPath}:`, error);
      // Continue with other directories even if one fails
    }
  }

  /**
   * Get disk usage statistics
   */
  async getDiskUsage(): Promise<DiskUsage> {
    try {
      // Use df command to get disk usage for current filesystem
      const { stdout } = await execAsync('df -k . | tail -1');
      const parts = stdout.trim().split(/\s+/);
      
      // df output: Filesystem 1K-blocks Used Available Use% Mounted
      const totalKB = parseInt(parts[1]);
      const usedKB = parseInt(parts[2]);
      const freeKB = parseInt(parts[3]);
      const percentUsed = parseInt(parts[4].replace('%', ''));

      return {
        total: totalKB / 1024 / 1024, // Convert to GB
        used: usedKB / 1024 / 1024,
        free: freeKB / 1024 / 1024,
        percentUsed
      };
    } catch (error) {
      console.error('[Maintenance] Error getting disk usage:', error);
      throw error;
    }
  }

  /**
   * Check disk space and take action if needed
   */
  async checkDiskSpace(): Promise<{ status: 'ok' | 'warning' | 'critical'; usage: DiskUsage; action?: string }> {
    try {
      const usage = await this.getDiskUsage();
      console.log(`[Maintenance] Disk usage: ${usage.percentUsed}% (${usage.used.toFixed(2)}GB / ${usage.total.toFixed(2)}GB)`);

      if (usage.percentUsed >= 90) {
        console.error('[Maintenance] CRITICAL: Disk usage at 90%+');
        
        // Emergency cleanup: delete ROI images older than 30 days
        console.log('[Maintenance] Running emergency cleanup (30-day retention)');
        await this.cleanupOldImages(30);
        
        // Re-check usage
        const newUsage = await this.getDiskUsage();
        const freedGB = usage.used - newUsage.used;
        console.log(`[Maintenance] Emergency cleanup freed ${freedGB.toFixed(2)}GB`);

        return {
          status: 'critical',
          usage: newUsage,
          action: `Emergency cleanup: deleted ROI images >30 days, freed ${freedGB.toFixed(2)}GB`
        };
      } else if (usage.percentUsed >= 80) {
        console.warn('[Maintenance] WARNING: Disk usage at 80%+');
        
        // Accelerated cleanup: delete ROI images older than 60 days
        console.log('[Maintenance] Running accelerated cleanup (60-day retention)');
        await this.cleanupOldImages(60);
        
        return {
          status: 'warning',
          usage,
          action: 'Accelerated cleanup: deleted ROI images >60 days'
        };
      }

      return { status: 'ok', usage };
    } catch (error) {
      console.error('[Maintenance] Error checking disk space:', error);
      throw error;
    }
  }

  /**
   * Run full maintenance routine
   * Called daily by scheduler
   */
  async runDailyMaintenance(): Promise<void> {
    if (this.cleanupRunning) {
      console.log('[Maintenance] Cleanup already running, skipping');
      return;
    }

    this.cleanupRunning = true;

    try {
      console.log('[Maintenance] Starting daily maintenance');
      const startTime = Date.now();

      // 1. Check disk space first (may trigger emergency cleanup)
      const diskCheck = await this.checkDiskSpace();
      console.log(`[Maintenance] Disk status: ${diskCheck.status}`);

      // 2. Clean up old detection logs (3 years retention)
      const deletedLogs = await this.cleanupOldLogs(1095); // 3 years = 1095 days

      // 3. Clean up old sent alerts (30 days retention)
      const deletedAlerts = await this.cleanupOldAlerts(30);

      // 4. Clean up old ROI images (2 months retention, unless emergency already ran)
      let imageCleanup = { deletedFiles: 0, freedMB: 0 };
      if (diskCheck.status === 'ok') {
        imageCleanup = await this.cleanupOldImages(60); // 2 months = 60 days
      }

      const duration = Date.now() - startTime;
      console.log(`[Maintenance] Daily maintenance completed in ${duration}ms`);
      console.log(`[Maintenance] Summary:`);
      console.log(`  - Deleted ${deletedLogs} detection logs (>3 years old)`);
      console.log(`  - Deleted ${deletedAlerts} sent alerts (>30 days old)`);
      console.log(`  - Deleted ${imageCleanup.deletedFiles} ROI images, freed ${imageCleanup.freedMB}MB`);
      console.log(`  - Disk usage: ${diskCheck.usage.percentUsed}% (${diskCheck.usage.free.toFixed(2)}GB free)`);

    } catch (error) {
      console.error('[Maintenance] Error during daily maintenance:', error);
      throw error; // Re-throw so caller knows maintenance failed
    } finally {
      // CRITICAL: Always reset flag, even on error, so future runs aren't blocked
      this.cleanupRunning = false;
    }
  }

  /**
   * Get maintenance statistics
   */
  async getMaintenanceStats(): Promise<{
    diskUsage: DiskUsage;
    oldestLog: Date | null;
    totalLogs: number;
    totalAlerts: number;
  }> {
    try {
      const diskUsage = await this.getDiskUsage();

      // Get oldest detection log
      const oldestLogResult = await db
        .select({ timestamp: detectionLogs.timestamp })
        .from(detectionLogs)
        .orderBy(detectionLogs.timestamp)
        .limit(1);

      // Count total logs and alerts
      const [logCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(detectionLogs);

      const [alertCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(alertQueue);

      return {
        diskUsage,
        oldestLog: oldestLogResult[0]?.timestamp || null,
        totalLogs: Number(logCount.count) || 0,
        totalAlerts: Number(alertCount.count) || 0
      };
    } catch (error) {
      console.error('[Maintenance] Error getting maintenance stats:', error);
      throw error;
    }
  }
}

export const maintenanceService = MaintenanceService.getInstance();
