import { getSheetsClient } from './sheets-client-oauth.js';
import type { IStorage } from '../storage';
import { format, toZonedTime } from 'date-fns-tz';
import { readDHT20 } from '../utils/dht20-sensor.js';
import cron, { ScheduledTask } from 'node-cron';

const TIMEZONE = 'Asia/Tokyo';

interface ToolRowMapping {
  category: string;
  toolNumber: number;
  row: number;
}

interface SlotState {
  slotId: string;
  toolName: string;
  slotNumber: number;
  status: 'PRESENT' | 'CHECKED_OUT' | 'UNKNOWN_CHECKOUT';
  workerName: string | null;
  checkoutStartColumn: number | null;
}

interface TimelineConfig {
  enabled: boolean;
  spreadsheetId: string | null;
  templateTabName: string;
  temperatureRow: number;
  humidityRow: number;
  confirmerRow: number;
  dataStartColumn: number;
}

interface DetectionResult {
  status: string;
  workerName?: string | null;
  workerId?: number | null;
}

export class TimelineLogger {
  private storage: IStorage;
  private config: TimelineConfig = {
    enabled: false,
    spreadsheetId: null,
    templateTabName: 'ひな形',
    temperatureRow: 65,
    humidityRow: 66,
    confirmerRow: 68,
    dataStartColumn: 3,
  };
  private toolRowMapping: ToolRowMapping[] = [];
  private slotStates: Map<string, SlotState> = new Map();
  private currentDayTabName: string | null = null;
  private cronTask: ScheduledTask | null = null;
  private isRunning = false;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  async initialize() {
    const enabledConfig = await this.storage.getConfigByKey('TIMELINE_ENABLED');
    this.config.enabled = enabledConfig?.value === true || enabledConfig?.value === 'true';

    const spreadsheetConfig = await this.storage.getConfigByKey('TIMELINE_SPREADSHEET_ID');
    this.config.spreadsheetId = spreadsheetConfig?.value as string || null;

    const templateConfig = await this.storage.getConfigByKey('TIMELINE_TEMPLATE_TAB');
    if (templateConfig?.value) {
      this.config.templateTabName = templateConfig.value as string;
    }

    const rowConfig = await this.storage.getConfigByKey('TIMELINE_ROW_CONFIG');
    if (rowConfig?.value) {
      const rc = rowConfig.value as any;
      this.config.temperatureRow = rc.temperatureRow || 65;
      this.config.humidityRow = rc.humidityRow || 66;
      this.config.confirmerRow = rc.confirmerRow || 68;
    }

    // Restore persisted slot states for cell merge continuity across restarts
    await this.restoreSlotStates();

    if (this.config.enabled && this.config.spreadsheetId) {
      console.log(`[TimelineLogger] Initialized with spreadsheet: ${this.config.spreadsheetId}`);
      await this.scanTemplateLayout();
    } else {
      console.log('[TimelineLogger] Not enabled or no spreadsheet configured');
    }
  }

  private async restoreSlotStates(): Promise<void> {
    try {
      const statesConfig = await this.storage.getConfigByKey('TIMELINE_SLOT_STATES');
      if (statesConfig?.value && typeof statesConfig.value === 'object') {
        const statesData = statesConfig.value as Record<string, SlotState>;
        this.slotStates = new Map(Object.entries(statesData));
        console.log(`[TimelineLogger] Restored ${this.slotStates.size} slot states from storage`);
      }
    } catch (error) {
      console.error('[TimelineLogger] Failed to restore slot states:', error);
    }
  }

  private async persistSlotStates(): Promise<void> {
    try {
      const statesData: Record<string, SlotState> = Object.fromEntries(this.slotStates);
      await this.storage.setConfig('TIMELINE_SLOT_STATES', statesData, 'Timeline slot checkout states for cell merge continuity');
    } catch (error) {
      console.error('[TimelineLogger] Failed to persist slot states:', error);
    }
  }

  async setConfig(updates: Partial<TimelineConfig>) {
    if (updates.enabled !== undefined) {
      await this.storage.setConfig('TIMELINE_ENABLED', updates.enabled, 'Enable 15-minute timeline logging');
      this.config.enabled = updates.enabled;
    }
    if (updates.spreadsheetId !== undefined) {
      await this.storage.setConfig('TIMELINE_SPREADSHEET_ID', updates.spreadsheetId, 'Timeline Google Sheets spreadsheet ID');
      this.config.spreadsheetId = updates.spreadsheetId;
    }
    if (updates.templateTabName !== undefined) {
      await this.storage.setConfig('TIMELINE_TEMPLATE_TAB', updates.templateTabName, 'Timeline template tab name');
      this.config.templateTabName = updates.templateTabName;
    }
    if (updates.temperatureRow !== undefined || updates.humidityRow !== undefined || updates.confirmerRow !== undefined) {
      await this.storage.setConfig('TIMELINE_ROW_CONFIG', {
        temperatureRow: updates.temperatureRow || this.config.temperatureRow,
        humidityRow: updates.humidityRow || this.config.humidityRow,
        confirmerRow: updates.confirmerRow || this.config.confirmerRow,
      }, 'Timeline row configuration');
      if (updates.temperatureRow) this.config.temperatureRow = updates.temperatureRow;
      if (updates.humidityRow) this.config.humidityRow = updates.humidityRow;
      if (updates.confirmerRow) this.config.confirmerRow = updates.confirmerRow;
    }
  }

  getConfig(): TimelineConfig {
    return { ...this.config };
  }

  async scanTemplateLayout(): Promise<void> {
    if (!this.config.spreadsheetId) {
      console.log('[TimelineLogger] No spreadsheet configured, cannot scan template');
      return;
    }

    try {
      const sheets = await getSheetsClient();
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `'${this.config.templateTabName}'!A1:B100`,
      });

      const rows = response.data.values || [];
      this.toolRowMapping = [];
      
      let currentCategory: string | null = null;

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 1;
        const colA = rows[i]?.[0]?.toString().trim() || '';
        const colB = rows[i]?.[1]?.toString().trim() || '';

        if (colA && colA !== 'しまむら現備品貸出チェック表' && !colA.includes('年') && colA !== '温度' && colA !== '湿度' && colA !== '確認者') {
          currentCategory = colA;
        }

        if (colB && currentCategory) {
          const toolNumber = parseInt(colB, 10);
          if (!isNaN(toolNumber)) {
            this.toolRowMapping.push({
              category: currentCategory,
              toolNumber,
              row: rowNum,
            });
          }
        }
      }

      console.log(`[TimelineLogger] Template scan complete: ${this.toolRowMapping.length} tool slots mapped`);
      
      const categories = Array.from(new Set(this.toolRowMapping.map(m => m.category)));
      for (const cat of categories) {
        const count = this.toolRowMapping.filter(m => m.category === cat).length;
        console.log(`[TimelineLogger]   - ${cat}: ${count} slots`);
      }

    } catch (error) {
      console.error('[TimelineLogger] Failed to scan template layout:', error);
      this.toolRowMapping = [];
    }
  }

  getRowForSlot(category: string, toolNumber: number): number {
    const mapping = this.toolRowMapping.find(
      m => m.category === category && m.toolNumber === toolNumber
    );
    return mapping?.row || -1;
  }

  private getColumnForTime(hour: number, minute: number): number {
    const quarterIndex = Math.floor(minute / 15);
    return this.config.dataStartColumn + (hour * 4) + quarterIndex;
  }

  private columnIndexToLetter(index: number): string {
    let result = '';
    let n = index;
    while (n >= 0) {
      result = String.fromCharCode((n % 26) + 65) + result;
      n = Math.floor(n / 26) - 1;
    }
    return result;
  }

  private getDayTabName(date: Date): string {
    const jstDate = toZonedTime(date, TIMEZONE);
    return format(jstDate, 'yyyy-MM-dd', { timeZone: TIMEZONE });
  }

  async ensureDayTab(date: Date): Promise<string> {
    if (!this.config.spreadsheetId) {
      throw new Error('No spreadsheet configured');
    }

    const sheets = await getSheetsClient();
    const tabName = this.getDayTabName(date);

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
    });

    const existingSheet = spreadsheet.data.sheets?.find(
      s => s.properties?.title === tabName
    );

    if (existingSheet) {
      console.log(`[TimelineLogger] Using existing tab: ${tabName}`);
      this.currentDayTabName = tabName;
      return tabName;
    }

    const templateSheet = spreadsheet.data.sheets?.find(
      s => s.properties?.title === this.config.templateTabName
    );

    if (!templateSheet || templateSheet.properties?.sheetId === undefined) {
      throw new Error(`Template tab "${this.config.templateTabName}" not found`);
    }

    const templateSheetId = templateSheet.properties.sheetId;
    const templateIndex = templateSheet.properties?.index ?? 0;

    console.log(`[TimelineLogger] Creating new tab: ${tabName}`);

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.config.spreadsheetId,
      requestBody: {
        requests: [{
          duplicateSheet: {
            sourceSheetId: templateSheetId,
            newSheetName: tabName,
            insertSheetIndex: templateIndex + 1,
          }
        }]
      }
    });

    const jstDate = toZonedTime(date, TIMEZONE);
    const dateHeader = format(jstDate, 'yyyy年 M月 d日', { timeZone: TIMEZONE });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: this.config.spreadsheetId,
      range: `'${tabName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[`しまむら現備品貸出チェック表　${dateHeader}`]]
      }
    });

    this.currentDayTabName = tabName;
    return tabName;
  }

  async startScheduler() {
    if (this.cronTask) {
      this.cronTask.stop();
    }

    this.cronTask = cron.schedule('*/15 * * * *', async () => {
      if (!this.config.enabled || !this.config.spreadsheetId) {
        return;
      }

      if (this.isRunning) {
        console.log('[TimelineLogger] Previous run still in progress, skipping');
        return;
      }

      try {
        this.isRunning = true;
        await this.runDetectionCycle();
      } catch (error) {
        console.error('[TimelineLogger] Detection cycle failed:', error);
      } finally {
        this.isRunning = false;
      }
    }, {
      timezone: TIMEZONE
    });

    console.log('[TimelineLogger] Started 15-minute scheduler');
  }

  stopScheduler() {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
      console.log('[TimelineLogger] Stopped scheduler');
    }
  }

  async runDetectionCycle(): Promise<void> {
    if (!this.config.enabled || !this.config.spreadsheetId) {
      console.log('[TimelineLogger] Not enabled or no spreadsheet, skipping cycle');
      return;
    }

    const now = toZonedTime(new Date(), TIMEZONE);
    const hour = now.getHours();
    const minute = now.getMinutes();
    const roundedMinute = Math.floor(minute / 15) * 15;

    console.log(`[TimelineLogger] Running detection cycle at ${hour}:${roundedMinute.toString().padStart(2, '0')}`);

    try {
      const tabName = await this.ensureDayTab(now);
      const columnIndex = this.getColumnForTime(hour, roundedMinute);
      const columnLetter = this.columnIndexToLetter(columnIndex);

      const slots = await this.storage.getSlots();
      const workers = await this.storage.getWorkers();
      const workerMap = new Map(workers.map(w => [w.arucoId, w.name]));

      const detectionResults = await this.runQuickDetection();

      const sheets = await getSheetsClient();
      const updates: { range: string; values: any[][] }[] = [];
      const formatRequests: any[] = [];

      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: this.config.spreadsheetId!,
      });
      const sheetInfo = spreadsheet.data.sheets?.find(s => s.properties?.title === tabName);
      const sheetId = sheetInfo?.properties?.sheetId;

      for (const slot of slots) {
        if (slot.slotType !== 'tool' || !slot.isActive) continue;

        const detection = detectionResults.get(slot.slotId);
        const row = this.findRowForSlot(slot.toolName, slot.slotNumber);
        
        if (row < 0) {
          continue;
        }

        const prevState = this.slotStates.get(slot.slotId);
        let newState: SlotState;
        let cellValue = '';
        let needsRedFill = false;

        if (!detection) {
          newState = {
            slotId: slot.slotId,
            toolName: slot.toolName,
            slotNumber: slot.slotNumber,
            status: 'PRESENT',
            workerName: null,
            checkoutStartColumn: null,
          };
        } else if (detection.status === 'ITEM_PRESENT' || detection.status === 'EMPTY') {
          newState = {
            slotId: slot.slotId,
            toolName: slot.toolName,
            slotNumber: slot.slotNumber,
            status: 'PRESENT',
            workerName: null,
            checkoutStartColumn: null,
          };

          if (prevState?.status === 'CHECKED_OUT' || prevState?.status === 'UNKNOWN_CHECKOUT') {
            if (prevState.checkoutStartColumn !== null && prevState.checkoutStartColumn < columnIndex) {
              await this.mergeCells(
                sheetId!,
                tabName,
                row,
                prevState.checkoutStartColumn,
                columnIndex - 1,
                prevState.workerName || '',
                prevState.status === 'UNKNOWN_CHECKOUT'
              );
            }
          }
        } else if (detection.status === 'CHECKED_OUT') {
          const workerName = detection.workerName || workerMap.get(detection.workerId || 0) || null;
          
          if (workerName) {
            newState = {
              slotId: slot.slotId,
              toolName: slot.toolName,
              slotNumber: slot.slotNumber,
              status: 'CHECKED_OUT',
              workerName,
              checkoutStartColumn: prevState?.status === 'CHECKED_OUT' && prevState.workerName === workerName
                ? prevState.checkoutStartColumn
                : columnIndex,
            };
            cellValue = workerName;
          } else {
            newState = {
              slotId: slot.slotId,
              toolName: slot.toolName,
              slotNumber: slot.slotNumber,
              status: 'UNKNOWN_CHECKOUT',
              workerName: null,
              checkoutStartColumn: prevState?.status === 'UNKNOWN_CHECKOUT'
                ? prevState.checkoutStartColumn
                : columnIndex,
            };
            needsRedFill = true;
          }
        } else {
          newState = {
            slotId: slot.slotId,
            toolName: slot.toolName,
            slotNumber: slot.slotNumber,
            status: 'PRESENT',
            workerName: null,
            checkoutStartColumn: null,
          };
        }

        this.slotStates.set(slot.slotId, newState);

        if (cellValue || needsRedFill) {
          updates.push({
            range: `'${tabName}'!${columnLetter}${row}`,
            values: [[cellValue]]
          });

          if (needsRedFill && sheetId !== undefined) {
            formatRequests.push({
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: row - 1,
                  endRowIndex: row,
                  startColumnIndex: columnIndex,
                  endColumnIndex: columnIndex + 1,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 1, green: 0.8, blue: 0.8 },
                  }
                },
                fields: 'userEnteredFormat.backgroundColor',
              }
            });
          }
        }
      }

      const envReading = await readDHT20();
      if (envReading.ok && envReading.temperature_c !== undefined && envReading.humidity !== undefined) {
        updates.push({
          range: `'${tabName}'!${columnLetter}${this.config.temperatureRow}`,
          values: [[`${envReading.temperature_c.toFixed(1)}°C`]]
        });
        updates.push({
          range: `'${tabName}'!${columnLetter}${this.config.humidityRow}`,
          values: [[`${envReading.humidity.toFixed(0)}%`]]
        });
        console.log(`[TimelineLogger] Environment: ${envReading.temperature_c.toFixed(1)}°C, ${envReading.humidity.toFixed(0)}%`);
      } else {
        updates.push({
          range: `'${tabName}'!${columnLetter}${this.config.temperatureRow}`,
          values: [['—']]
        });
        updates.push({
          range: `'${tabName}'!${columnLetter}${this.config.humidityRow}`,
          values: [['—']]
        });
      }

      if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.config.spreadsheetId!,
          requestBody: {
            valueInputOption: 'RAW',
            data: updates,
          },
        });
        console.log(`[TimelineLogger] Updated ${updates.length} cells`);
      }

      if (formatRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.config.spreadsheetId!,
          requestBody: {
            requests: formatRequests,
          },
        });
        console.log(`[TimelineLogger] Applied ${formatRequests.length} format updates`);
      }

      // Persist slot states to survive server restarts (ensures cell merge continuity)
      await this.persistSlotStates();

    } catch (error) {
      console.error('[TimelineLogger] Detection cycle error:', error);
      throw error;
    }
  }

  private findRowForSlot(toolName: string, slotNumber: number): number {
    const mapping = this.toolRowMapping.find(
      m => m.category === toolName && m.toolNumber === slotNumber
    );
    return mapping?.row || -1;
  }

  private async mergeCells(
    sheetId: number,
    tabName: string,
    row: number,
    startColumn: number,
    endColumn: number,
    value: string,
    isUnknown: boolean
  ): Promise<void> {
    if (!this.config.spreadsheetId || startColumn >= endColumn) return;

    try {
      const sheets = await getSheetsClient();

      const requests: any[] = [
        {
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: row - 1,
              endRowIndex: row,
              startColumnIndex: startColumn,
              endColumnIndex: endColumn + 1,
            },
            mergeType: 'MERGE_ALL',
          }
        }
      ];

      if (isUnknown) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: row - 1,
              endRowIndex: row,
              startColumnIndex: startColumn,
              endColumnIndex: endColumn + 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 1, green: 0.6, blue: 0.6 },
              }
            },
            fields: 'userEnteredFormat.backgroundColor',
          }
        });
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.config.spreadsheetId,
        requestBody: { requests },
      });

      const startLetter = this.columnIndexToLetter(startColumn);
      await sheets.spreadsheets.values.update({
        spreadsheetId: this.config.spreadsheetId,
        range: `'${tabName}'!${startLetter}${row}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[value]]
        }
      });

      console.log(`[TimelineLogger] Merged cells ${startLetter}${row}:${this.columnIndexToLetter(endColumn)}${row} with value "${value}"`);

    } catch (error) {
      console.error('[TimelineLogger] Failed to merge cells:', error);
    }
  }

  private async runQuickDetection(): Promise<Map<string, DetectionResult>> {
    const results = new Map<string, DetectionResult>();
    
    try {
      const recentLogs = await this.storage.getDetectionLogs(200, 0);
      
      const latestBySlot = new Map<string, DetectionResult>();
      for (const log of recentLogs) {
        if (!latestBySlot.has(log.slotId)) {
          const rawData = log.rawDetectionData as Record<string, any> | null;
          latestBySlot.set(log.slotId, {
            status: log.status,
            workerName: log.workerName,
            workerId: rawData?.worker_aruco_id as number | undefined,
          });
        }
      }

      return latestBySlot;
    } catch (error) {
      console.error('[TimelineLogger] Quick detection failed:', error);
      return results;
    }
  }

  async runManualCycle(): Promise<{ success: boolean; message: string }> {
    if (!this.config.enabled) {
      return { success: false, message: 'タイムラインロガーが無効です' };
    }
    if (!this.config.spreadsheetId) {
      return { success: false, message: 'スプレッドシートが設定されていません' };
    }

    try {
      await this.runDetectionCycle();
      return { success: true, message: 'タイムライン更新が完了しました' };
    } catch (error) {
      return { success: false, message: `エラー: ${error instanceof Error ? error.message : '不明なエラー'}` };
    }
  }
}

let timelineLoggerInstance: TimelineLogger | null = null;

export function getTimelineLogger(storage: IStorage): TimelineLogger {
  if (!timelineLoggerInstance) {
    timelineLoggerInstance = new TimelineLogger(storage);
  }
  return timelineLoggerInstance;
}
