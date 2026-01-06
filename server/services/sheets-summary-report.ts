import { getSheetsClient } from './sheets-client-oauth.js';
import type { IStorage } from '../storage';
import { format, toZonedTime } from 'date-fns-tz';
import { startOfWeek, addDays } from 'date-fns';

const TIMEZONE = 'Asia/Tokyo';

interface ToolSummary {
  toolName: string;
  totalCount: number;
  presentCount: number;
  missingCount: number;
  isCheckType: boolean; // true = ✔点 (just check mark), false = 返却数/貸出数
  cameraFailed: boolean; // true if all slots for this tool are on failed cameras
}

interface CaptureTimeSummary {
  captureTime: string; // HH:mm format
  dayOfWeek: string; // 月, 火, 水, 木, 金
  tools: ToolSummary[];
}

// Rows to skip when writing quantities (user-specified)
const SKIP_ROWS = [10, 11, 17, 18, 20, 21];

// Row where the N circle stamp exists in column D
const STAMP_ROW = 22;

interface ToolRowMapping {
  toolName: string;
  returnRow: number;    // Row for 返却数
  checkoutRow: number;  // Row for 貸出数
  totalCount: number | null;  // 定数 from Column B in Template
}

export class SheetsSummaryReport {
  private storage: IStorage;
  private spreadsheetId: string | null = null;
  private currentSheetName: string | null = null; // Current week's tab name
  private templateRowMapping: ToolRowMapping[] = []; // Dynamic row mapping from Template

  // Default tool configuration matching user's format
  // Can be overridden via SUMMARY_TOOL_CONFIG in database
  private defaultToolConfig = [
    { name: '安全カッター', totalCount: 20, isCheckType: false },
    { name: 'OPPテープ', totalCount: 9, isCheckType: false },
    { name: '赤マジック', totalCount: 16, isCheckType: false },
    { name: '電卓', totalCount: 6, isCheckType: false },
    { name: '大型OPP', totalCount: 1, isCheckType: true },
  ];

  private toolConfig: Array<{ name: string; totalCount: number; isCheckType: boolean }> = [];

  private captureTimes = ['08:00', '11:00', '14:00', '17:00'];
  private dayLabels = ['月', '火', '水', '木', '金'];

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  async initialize() {
    const config = await this.storage.getConfigByKey('SUMMARY_SPREADSHEET_ID');
    this.spreadsheetId = config?.value as string || null;

    // Load tool configuration from database or use defaults
    const toolConfigData = await this.storage.getConfigByKey('SUMMARY_TOOL_CONFIG');
    if (toolConfigData?.value && Array.isArray(toolConfigData.value)) {
      this.toolConfig = toolConfigData.value as Array<{ name: string; totalCount: number; isCheckType: boolean }>;
      console.log(`[SheetsSummaryReport] Loaded ${this.toolConfig.length} tools from config`);
    } else {
      this.toolConfig = [...this.defaultToolConfig];
      console.log('[SheetsSummaryReport] Using default tool configuration');
    }

    if (!this.spreadsheetId) {
      console.log('[SheetsSummaryReport] No spreadsheet ID configured. Set SUMMARY_SPREADSHEET_ID in config.');
    }
  }

  getToolConfig() {
    return this.toolConfig;
  }

  /**
   * Scan the Template tab to build dynamic row mapping for each tool
   * This reads column A and C to find tool names and their row positions
   */
  async scanTemplateLayout(): Promise<void> {
    if (!this.spreadsheetId) {
      console.log('[SheetsSummaryReport] No spreadsheet configured, cannot scan template');
      return;
    }

    try {
      const sheets = await getSheetsClient();
      
      // Find the template tab name (supports both "Template" and "ひな形")
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });
      const templateSheet = spreadsheet.data.sheets?.find(
        s => s.properties?.title?.toLowerCase() === 'template' || s.properties?.title === 'ひな形'
      );
      const templateTabName = templateSheet?.properties?.title || 'Template';
      
      // Read columns A, B, and C from Template tab (rows 1-30 should cover all tools)
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${templateTabName}'!A1:C30`,
      });

      const rows = response.data.values || [];
      this.templateRowMapping = [];
      
      let currentToolName: string | null = null;
      let currentToolReturnRow: number = -1;
      let currentToolTotalCount: number | null = null;

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 1; // 1-indexed row number
        const colA = rows[i]?.[0]?.toString().trim() || '';
        const colB = rows[i]?.[1]?.toString().trim() || '';
        const colC = rows[i]?.[2]?.toString().trim() || '';

        // Skip rows that should be ignored
        if (SKIP_ROWS.includes(rowNum)) {
          continue;
        }

        // Check if column A has a tool name (non-empty and not a header)
        if (colA && colA !== '備品名' && colA !== '確認者') {
          currentToolName = colA;
          
          // Parse Column B as totalCount (定数)
          // Handle numeric values and special text like "各自2点"
          const numericValue = parseInt(colB, 10);
          currentToolTotalCount = !isNaN(numericValue) ? numericValue : null;
          
          // Check if column C indicates this is 返却数 row
          if (colC === '返却数') {
            currentToolReturnRow = rowNum;
          }
        }

        // Check if this row is 貸出数 for the current tool
        if (currentToolName && colC === '貸出数' && currentToolReturnRow > 0) {
          this.templateRowMapping.push({
            toolName: currentToolName,
            returnRow: currentToolReturnRow,
            checkoutRow: rowNum,
            totalCount: currentToolTotalCount,
          });
          console.log(`[SheetsSummaryReport] Mapped tool "${currentToolName}": 返却数=row ${currentToolReturnRow}, 貸出数=row ${rowNum}, 定数=${currentToolTotalCount ?? 'N/A'}`);
          
          // Reset for next tool
          currentToolName = null;
          currentToolReturnRow = -1;
          currentToolTotalCount = null;
        }
      }

      console.log(`[SheetsSummaryReport] Template scan complete: ${this.templateRowMapping.length} tools mapped`);

    } catch (error) {
      console.error('[SheetsSummaryReport] Failed to scan Template layout:', error);
      // Fall back to empty mapping - will use toolConfig-based calculation
      this.templateRowMapping = [];
    }
  }

  /**
   * Get row number for a tool from the scanned template mapping
   */
  private getTemplateRowForTool(toolName: string, rowType: '返却数' | '貸出数'): number {
    const mapping = this.templateRowMapping.find(m => m.toolName === toolName);
    if (!mapping) {
      console.warn(`[SheetsSummaryReport] No template mapping found for tool: ${toolName}`);
      return -1;
    }
    return rowType === '返却数' ? mapping.returnRow : mapping.checkoutRow;
  }

  /**
   * Get totalCount (定数) for a tool from the Template tab.
   * Returns null if not found or not a numeric value.
   */
  private getTemplateTotalCount(toolName: string): number | null {
    const mapping = this.templateRowMapping.find(m => m.toolName === toolName);
    return mapping?.totalCount ?? null;
  }

  async setToolConfig(config: Array<{ name: string; totalCount: number; isCheckType: boolean }>) {
    this.toolConfig = config;
    await this.storage.setConfig('SUMMARY_TOOL_CONFIG', config, 'Summary report tool configuration');
    console.log(`[SheetsSummaryReport] Updated tool config with ${config.length} tools`);
  }

  setSpreadsheetId(id: string) {
    this.spreadsheetId = id;
  }

  getSpreadsheetId(): string | null {
    return this.spreadsheetId;
  }

  private getWeekDateRange(date: Date): { start: Date; end: Date; startStr: string; endStr: string; tabName: string } {
    const jstDate = toZonedTime(date, TIMEZONE);
    const start = startOfWeek(jstDate, { weekStartsOn: 1 }); // Monday
    const end = addDays(start, 4); // Friday

    return {
      start,
      end,
      startStr: format(start, 'M月d日', { timeZone: TIMEZONE }),
      endStr: format(end, 'M月d日', { timeZone: TIMEZONE }),
      tabName: format(start, 'yy-MM-dd', { timeZone: TIMEZONE }) + 'の週', // e.g., "24-12-23の週"
    };
  }

  private async ensureWeeklyTab(): Promise<string> {
    if (!this.spreadsheetId) {
      throw new Error('No spreadsheet configured');
    }

    const sheets = await getSheetsClient();
    const now = toZonedTime(new Date(), TIMEZONE);
    const weekRange = this.getWeekDateRange(now);
    const tabName = weekRange.tabName;

    // Get spreadsheet info to check existing tabs
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    // Check if the weekly tab already exists
    const existingSheet = spreadsheet.data.sheets?.find(
      s => s.properties?.title === tabName
    );

    if (existingSheet) {
      console.log(`[SheetsSummaryReport] Using existing tab: ${tabName}`);
      this.currentSheetName = tabName;
      return tabName;
    }

    // Find the Template tab to duplicate (supports both "Template" and "ひな形")
    const templateSheet = spreadsheet.data.sheets?.find(
      s => s.properties?.title?.toLowerCase() === 'template' || s.properties?.title === 'ひな形'
    );

    const existingTabs = spreadsheet.data.sheets?.map(s => `${s.properties?.title}(id:${s.properties?.sheetId})`).join(', ') || 'none';
    console.log(`[SheetsSummaryReport] Available tabs: ${existingTabs}`);

    if (!templateSheet || templateSheet.properties?.sheetId === undefined) {
      throw new Error(`Template tab not found or has no sheetId. Available tabs: ${existingTabs}. Please create a tab named "Template" with the desired format.`);
    }

    const templateSheetId = templateSheet.properties.sheetId;

    // Duplicate the Template tab with the new name
    // Insert at index 1 (right after Template) so newest week is always near the left
    const templateIndex = templateSheet.properties?.index ?? 0;
    console.log(`[SheetsSummaryReport] Duplicating Template tab as: ${tabName} (inserting at index ${templateIndex + 1})`);

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{
          duplicateSheet: {
            sourceSheetId: templateSheetId,
            newSheetName: tabName,
            insertSheetIndex: templateIndex + 1, // Insert right after Template
          }
        }]
      }
    });

    // Update dynamic header cells on the new tab
    await this.updateWeeklyHeader(tabName);

    this.currentSheetName = tabName;
    return tabName;
  }

  private async updateWeeklyHeader(tabName: string): Promise<void> {
    if (!this.spreadsheetId) return;

    const sheets = await getSheetsClient();
    const now = toZonedTime(new Date(), TIMEZONE);
    const weekRange = this.getWeekDateRange(now);
    const year = format(now, 'yyyy', { timeZone: TIMEZONE });

    // Update the date range in row 2 (replacing placeholder "20XX年 X月 X日 ～ X月 X日")
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          {
            range: `'${tabName}'!A2`,
            values: [[`${year}年 ${weekRange.startStr} ～ ${weekRange.endStr}`]]
          }
        ],
      },
    });

    console.log(`[SheetsSummaryReport] Updated date range in row 2 for tab: ${tabName}`);
  }

  private getColumnForCaptureTime(dayOfWeek: number, captureTimeIndex: number): string {
    // dayOfWeek: 0=Monday, 1=Tuesday, etc.
    // captureTimeIndex: 0=8:00, 1=11:00, 2=14:00, 3=17:00
    // Column layout: A=備品名, B=定数, C=確認, D=月8:00, E=月11:00, F=月14:00, G=月17:00, H=火8:00...
    const baseColumn = 3; // D is column index 3 (0-indexed)
    const columnIndex = baseColumn + (dayOfWeek * 4) + captureTimeIndex;
    return this.columnIndexToLetter(columnIndex);
  }

  private columnIndexToLetter(index: number): string {
    let result = '';
    while (index >= 0) {
      result = String.fromCharCode((index % 26) + 65) + result;
      index = Math.floor(index / 26) - 1;
    }
    return result;
  }

  private getRowForTool(toolName: string, rowType: '返却数' | '貸出数' | '確認'): number {
    // Row layout is dynamic based on toolConfig:
    // Row 1: Header (date range)
    // Row 2: Time slots header
    // Starting from Row 3: tools listed in order from toolConfig
    // - Non-checkType tools: 2 rows each (返却数, 貸出数)
    // - CheckType tools: 1 row each (確認✔点)

    let currentRow = 3; // Start after headers

    for (const tool of this.toolConfig) {
      if (tool.name === toolName) {
        if (tool.isCheckType) {
          return currentRow; // Only one row for check type
        } else {
          return rowType === '返却数' ? currentRow : currentRow + 1;
        }
      }

      // Move to next tool's starting row
      currentRow += tool.isCheckType ? 1 : 2;
    }

    return -1; // Tool not found
  }

  async syncAfterCapture(captureTime: string, failedCameraIds: string[] = []): Promise<void> {
    if (!this.spreadsheetId) {
      console.log('[SheetsSummaryReport] No spreadsheet configured, skipping sync');
      return;
    }

    try {
      const sheets = await getSheetsClient();
      const now = toZonedTime(new Date(), TIMEZONE);
      const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, etc.

      // Only sync on weekdays (Monday=1 to Friday=5)
      if (dayOfWeek < 1 || dayOfWeek > 5) {
        console.log('[SheetsSummaryReport] Not a weekday, skipping sync');
        return;
      }

      // Scan template layout if not done yet
      if (this.templateRowMapping.length === 0) {
        await this.scanTemplateLayout();
      }

      // Ensure we have a tab for this week (creates if needed)
      const sheetName = await this.ensureWeeklyTab();

      const mondayBasedDay = dayOfWeek - 1; // Convert to 0=Monday
      const captureTimeIndex = this.captureTimes.indexOf(captureTime);

      if (captureTimeIndex === -1) {
        console.log(`[SheetsSummaryReport] Unknown capture time: ${captureTime}`);
        return;
      }

      if (failedCameraIds.length > 0) {
        console.log(`[SheetsSummaryReport] Cameras with failures: ${failedCameraIds.join(', ')}`);
      }

      // Get today's detection logs for this capture time
      const summary = await this.calculateToolSummary(now, captureTime, failedCameraIds);

      // Prepare batch update values
      const updates: { range: string; values: any[][] }[] = [];
      const column = this.getColumnForCaptureTime(mondayBasedDay, captureTimeIndex);

      for (const tool of summary) {
        // If camera failed for this tool, show ❌ instead of numbers
        if (tool.cameraFailed) {
          const returnRow = this.getTemplateRowForTool(tool.toolName, '返却数');
          const checkoutRow = this.getTemplateRowForTool(tool.toolName, '貸出数');
          
          if (returnRow > 0 && !SKIP_ROWS.includes(returnRow)) {
            updates.push({
              range: `'${sheetName}'!${column}${returnRow}`,
              values: [['❌']]
            });
          }
          if (!tool.isCheckType && checkoutRow > 0 && !SKIP_ROWS.includes(checkoutRow)) {
            updates.push({
              range: `'${sheetName}'!${column}${checkoutRow}`,
              values: [['❌']]
            });
          }
          console.log(`[SheetsSummaryReport] Marked tool "${tool.toolName}" with ❌ due to camera failure`);
          continue;
        }

        if (tool.isCheckType) {
          // ✔点 type - just check or X (use template mapping or fallback)
          const row = this.getTemplateRowForTool(tool.toolName, '返却数');
          if (row > 0 && !SKIP_ROWS.includes(row)) {
            const value = tool.presentCount > 0 ? '✔' : 'X';
            updates.push({
              range: `'${sheetName}'!${column}${row}`,
              values: [[value]]
            });
          }
        } else {
          // 返却数/貸出数 type - use template row mapping
          const returnRow = this.getTemplateRowForTool(tool.toolName, '返却数');
          const checkoutRow = this.getTemplateRowForTool(tool.toolName, '貸出数');

          if (returnRow > 0 && !SKIP_ROWS.includes(returnRow)) {
            updates.push({
              range: `'${sheetName}'!${column}${returnRow}`,
              values: [[tool.presentCount]]
            });
          }
          if (checkoutRow > 0 && !SKIP_ROWS.includes(checkoutRow)) {
            updates.push({
              range: `'${sheetName}'!${column}${checkoutRow}`,
              values: [[tool.missingCount]]
            });
          }
        }
      }

      // Execute batch update for quantities
      if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: updates,
          },
        });

        console.log(`[SheetsSummaryReport] Synced ${updates.length} cells for ${captureTime} on ${this.dayLabels[mondayBasedDay]} to tab '${sheetName}'`);
      }

      // Copy N circle stamp from D23 to the time column row 23
      await this.copyStampToColumn(sheetName, column);

    } catch (error) {
      console.error('[SheetsSummaryReport] Failed to sync:', error);
      throw error;
    }
  }

  /**
   * Copy the N circle stamp from D23 to the specified column row 23
   */
  private async copyStampToColumn(sheetName: string, column: string): Promise<void> {
    if (!this.spreadsheetId) return;

    try {
      const sheets = await getSheetsClient();

      // Read the stamp value from D23
      const stampResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${sheetName}'!D${STAMP_ROW}`,
      });

      const stampValue = stampResponse.data.values?.[0]?.[0] || '';

      if (stampValue) {
        // Write the stamp to the time column row 23
        await sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `'${sheetName}'!${column}${STAMP_ROW}`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [[stampValue]]
          }
        });

        console.log(`[SheetsSummaryReport] Copied N stamp from D${STAMP_ROW} to ${column}${STAMP_ROW}`);
      } else {
        console.log(`[SheetsSummaryReport] No stamp found at D${STAMP_ROW}, skipping stamp copy`);
      }

    } catch (error) {
      console.error('[SheetsSummaryReport] Failed to copy stamp:', error);
      // Don't throw - stamp copy is not critical
    }
  }

  private async calculateToolSummary(date: Date, captureTime: string, failedCameraIds: string[] = []): Promise<ToolSummary[]> {
    const summaries: ToolSummary[] = [];

    // Get all slots grouped by tool name
    const allSlots = await this.storage.getSlots();
    const slotsByTool: Record<string, typeof allSlots> = {};

    for (const slot of allSlots) {
      if (!slotsByTool[slot.toolName]) {
        slotsByTool[slot.toolName] = [];
      }
      slotsByTool[slot.toolName].push(slot);
    }

    // Get detection logs from the last hour (to capture the most recent scheduled run)
    const oneHourAgo = new Date(date.getTime() - 60 * 60 * 1000);

    for (const toolConfig of this.toolConfig) {
      const slots = slotsByTool[toolConfig.name] || [];
      let presentCount = 0;

      // Use Template's totalCount (定数) as primary source, fall back to toolConfig
      const templateTotal = this.getTemplateTotalCount(toolConfig.name);
      const baseTotalCount = templateTotal ?? toolConfig.totalCount;

      // If no slots match this tool name, we can't detect - mark as unknown/missing
      if (slots.length === 0) {
        console.warn(`[SheetsSummaryReport] Warning: Tool "${toolConfig.name}" has no matching slots configured. Cannot detect inventory.`);
        summaries.push({
          toolName: toolConfig.name,
          totalCount: baseTotalCount,
          presentCount: 0, // Can't confirm any present without slots
          missingCount: baseTotalCount, // Treat as all missing until slots configured
          isCheckType: toolConfig.isCheckType,
          cameraFailed: false,
        });
        continue;
      }

      // Check if ALL slots for this tool are on failed cameras
      // A tool is marked as camera failed only if every slot belongs to a failed camera
      const allSlotsOnFailedCameras = slots.length > 0 && slots.every(slot => failedCameraIds.includes(slot.cameraId));
      
      if (allSlotsOnFailedCameras) {
        console.log(`[SheetsSummaryReport] Tool "${toolConfig.name}" - all ${slots.length} slots on failed camera(s)`);
        summaries.push({
          toolName: toolConfig.name,
          totalCount: baseTotalCount,
          presentCount: 0,
          missingCount: 0,
          isCheckType: toolConfig.isCheckType,
          cameraFailed: true,
        });
        continue;
      }

      // Filter out slots on failed cameras for counting
      const workingSlots = slots.filter(slot => !failedCameraIds.includes(slot.cameraId));
      const failedSlotCount = slots.length - workingSlots.length;

      if (failedSlotCount > 0) {
        console.log(`[SheetsSummaryReport] Tool "${toolConfig.name}" - ${failedSlotCount} of ${slots.length} slots on failed camera(s), counting ${workingSlots.length} working slots`);
      }

      for (const slot of workingSlots) {
        // Get the latest detection log for this slot
        const logs = await this.storage.getDetectionLogsBySlot(slot.id);
        const recentLog = logs.find(log => new Date(log.timestamp) >= oneHourAgo);

        if (recentLog) {
          if (recentLog.status === 'ITEM_PRESENT') {
            presentCount++;
          }
          // EMPTY, CHECKED_OUT, etc. are not counted as present
        } else {
          // No recent detection - get the latest log regardless of time
          const latestLog = logs[0]; // Logs are ordered by timestamp desc
          if (latestLog && latestLog.status === 'ITEM_PRESENT') {
            presentCount++;
          }
          // If no logs at all, assume empty/missing
        }
      }

      // Adjust totalCount to exclude slots on failed cameras
      // This prevents inflating the missing count when some cameras fail
      const adjustedTotal = failedSlotCount > 0 
        ? Math.max(0, baseTotalCount - failedSlotCount)
        : baseTotalCount;
      const missingCount = Math.max(0, adjustedTotal - presentCount);

      summaries.push({
        toolName: toolConfig.name,
        totalCount: adjustedTotal,
        presentCount,
        missingCount,
        isCheckType: toolConfig.isCheckType,
        cameraFailed: false,
      });
    }

    return summaries;
  }

  async createWeeklyTab(): Promise<string> {
    if (!this.spreadsheetId) {
      throw new Error('No spreadsheet configured. Set spreadsheet ID first.');
    }

    try {
      const tabName = await this.ensureWeeklyTab();
      console.log(`[SheetsSummaryReport] Weekly tab ready: ${tabName}`);
      return tabName;

    } catch (error) {
      console.error('[SheetsSummaryReport] Failed to create weekly tab:', error);
      throw error;
    }
  }

  private async initializeSheetStructure(spreadsheetId: string, tabName: string): Promise<void> {
    const sheets = await getSheetsClient();
    const now = toZonedTime(new Date(), TIMEZONE);
    const weekRange = this.getWeekDateRange(now);
    const year = format(now, 'yyyy', { timeZone: TIMEZONE });

    // Build header rows
    const headerRow1 = [
      `東京４回物流部１部　しまむら班　備品貸出チェック表 ${year}年 ${weekRange.startStr} ～ ${weekRange.endStr}`,
      '', '', // 定数, 確認
    ];

    // Add day labels with merged cells concept (we'll just repeat for now)
    for (const day of this.dayLabels) {
      headerRow1.push(day, '', '', '');
    }
    headerRow1.push(`更新日：${format(now, 'yyyy-MM-dd', { timeZone: TIMEZONE })}`);

    const headerRow2 = ['備品名', '定数', '確認'];
    for (let i = 0; i < 5; i++) {
      headerRow2.push(...this.captureTimes);
    }

    // Build data rows
    const dataRows: string[][] = [];

    for (const tool of this.toolConfig) {
      if (tool.isCheckType) {
        dataRows.push([tool.name, String(tool.totalCount), '確認✔点', ...Array(20).fill('')]);
      } else {
        dataRows.push([tool.name, String(tool.totalCount), '返却数', ...Array(20).fill('')]);
        dataRows.push(['', '', '貸出数', ...Array(20).fill('')]);
      }
    }

    // Add 確認者 row at the bottom
    dataRows.push(['確認者', '', '', ...Array(20).fill('')]);

    // Write all data to the specific tab
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headerRow1, headerRow2, ...dataRows],
      },
    });
  }

  getSpreadsheetUrl(): string | null {
    if (!this.spreadsheetId) {
      return null;
    }
    return `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}`;
  }
}
