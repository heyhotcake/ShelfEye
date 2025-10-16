import { getSheetsClient } from './sheets-client-oauth.js';
import type { IStorage } from '../storage';

export interface SheetsLogEntry {
  timestamp: string;
  alertType: string;
  status: string;
  cameraId?: string;
  slotId?: string;
  errorMessage?: string;
  details?: Record<string, any>;
}

export class SheetsLogger {
  private storage: IStorage;
  private spreadsheetId: string | null = null;
  private formattingConfig: any;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  async initialize() {
    const config = await this.storage.getConfigByKey('SHEETS_SPREADSHEET_ID');
    this.spreadsheetId = config?.value as string || null;

    const formatConfig = await this.storage.getConfigByKey('SHEETS_FORMATTING');
    this.formattingConfig = formatConfig?.value || {
      tabCreation: 'monthly',
      tabNamePattern: 'Alerts-{YYYY-MM}',
      columnOrder: ['timestamp', 'alertType', 'status', 'cameraId', 'slotId', 'errorMessage', 'details'],
      includeHeaders: true,
      freezeHeaderRow: true,
      autoResize: true
    };

    if (!this.spreadsheetId) {
      console.log('[SheetsLogger] No spreadsheet ID configured, will create new spreadsheet on first log');
    }
  }

  private getTabName(date: Date): string {
    const pattern = this.formattingConfig.tabNamePattern || 'Alerts-{YYYY-MM}';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const weekNum = Math.ceil(date.getDate() / 7);

    return pattern
      .replace('{YYYY}', String(year))
      .replace('{MM}', month)
      .replace('{DD}', day)
      .replace('{WW}', String(weekNum));
  }

  async ensureSpreadsheet(): Promise<string> {
    if (this.spreadsheetId) {
      return this.spreadsheetId;
    }

    try {
      const sheets = await getSheetsClient();
      
      const tabName = this.formattingConfig.tabCreation === 'single' ? 'Alert Log' : this.getTabName(new Date());
      const headerRow = this.formattingConfig.columnOrder.map((col: string) => {
        const headers: Record<string, string> = {
          timestamp: 'Timestamp',
          alertType: 'Alert Type',
          status: 'Status',
          cameraId: 'Camera ID',
          slotId: 'Slot ID',
          errorMessage: 'Error Message',
          details: 'Details'
        };
        return { userEnteredValue: { stringValue: headers[col] || col } };
      });
      
      const response = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: `Tool Tracker Alert Log - ${new Date().toISOString().split('T')[0]}`,
          },
          sheets: [
            {
              properties: {
                title: tabName,
              },
              data: this.formattingConfig.includeHeaders ? [
                {
                  startRow: 0,
                  startColumn: 0,
                  rowData: [{ values: headerRow }],
                },
              ] : undefined,
            },
          ],
        },
      });

      this.spreadsheetId = response.data.spreadsheetId || null;
      
      if (this.spreadsheetId) {
        await this.storage.setConfig('SHEETS_SPREADSHEET_ID', this.spreadsheetId, 'Google Sheets ID for alert logging');
        console.log(`[SheetsLogger] Created new spreadsheet: ${this.spreadsheetId}`);
        
        // Apply formatting if enabled
        if (this.formattingConfig.freezeHeaderRow && this.formattingConfig.includeHeaders) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: [
                {
                  updateSheetProperties: {
                    properties: {
                      sheetId: 0,
                      gridProperties: {
                        frozenRowCount: 1
                      }
                    },
                    fields: 'gridProperties.frozenRowCount'
                  }
                }
              ]
            }
          });
        }
      }

      return this.spreadsheetId!;
    } catch (error) {
      console.error('[SheetsLogger] Failed to create spreadsheet:', error);
      throw error;
    }
  }

  private async ensureTabExists(tabName: string): Promise<void> {
    if (!this.spreadsheetId || this.formattingConfig.tabCreation === 'single') {
      return;
    }

    try {
      const sheets = await getSheetsClient();
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
      
      const tabExists = spreadsheet.data.sheets?.some(sheet => sheet.properties?.title === tabName);
      
      if (!tabExists) {
        const headerRow = this.formattingConfig.columnOrder.map((col: string) => {
          const headers: Record<string, string> = {
            timestamp: 'Timestamp',
            alertType: 'Alert Type',
            status: 'Status',
            cameraId: 'Camera ID',
            slotId: 'Slot ID',
            errorMessage: 'Error Message',
            details: 'Details'
          };
          return headers[col] || col;
        });

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: tabName,
                  }
                }
              }
            ]
          }
        });

        // Add headers if enabled
        if (this.formattingConfig.includeHeaders) {
          await sheets.spreadsheets.values.append({
            spreadsheetId: this.spreadsheetId,
            range: `${tabName}!A1`,
            valueInputOption: 'RAW',
            requestBody: {
              values: [headerRow],
            },
          });
        }

        console.log(`[SheetsLogger] Created new tab: ${tabName}`);
      }
    } catch (error) {
      console.error('[SheetsLogger] Failed to ensure tab exists:', error);
    }
  }

  async logAlert(entry: SheetsLogEntry): Promise<void> {
    try {
      const spreadsheetId = await this.ensureSpreadsheet();
      const sheets = await getSheetsClient();

      // Determine tab name based on creation rules
      const entryDate = new Date(entry.timestamp);
      const tabName = this.formattingConfig.tabCreation === 'single' ? 'Alert Log' : this.getTabName(entryDate);
      
      // Ensure the tab exists
      await this.ensureTabExists(tabName);

      // Build row according to column order
      const rowData: Record<string, string> = {
        timestamp: entry.timestamp,
        alertType: entry.alertType,
        status: entry.status,
        cameraId: entry.cameraId || '',
        slotId: entry.slotId || '',
        errorMessage: entry.errorMessage || '',
        details: entry.details ? JSON.stringify(entry.details) : '',
      };

      const values = [
        this.formattingConfig.columnOrder.map((col: string) => rowData[col] || '')
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tabName}!A:Z`,
        valueInputOption: 'RAW',
        requestBody: {
          values,
        },
      });

      console.log(`[SheetsLogger] Logged alert: ${entry.alertType} at ${entry.timestamp} to tab ${tabName}`);
    } catch (error) {
      console.error('[SheetsLogger] Failed to log to sheets:', error);
      throw error;
    }
  }

  async logCapture(data: {
    timestamp: string;
    triggerType: string;
    camerasCaptured: number;
    slotsProcessed: number;
    failureCount: number;
    status: string;
    executionTimeMs: number;
  }): Promise<void> {
    try {
      const entry: SheetsLogEntry = {
        timestamp: data.timestamp,
        alertType: data.triggerType === 'diagnostic' ? 'DIAGNOSTIC_RUN' : 'CAPTURE_RUN',
        status: data.status,
        errorMessage: `Cameras: ${data.camerasCaptured}, Slots: ${data.slotsProcessed}, Failures: ${data.failureCount}`,
        details: {
          executionTimeMs: data.executionTimeMs,
        },
      };

      await this.logAlert(entry);
    } catch (error) {
      console.error('[SheetsLogger] Failed to log capture run:', error);
    }
  }

  getSpreadsheetUrl(): string | null {
    if (!this.spreadsheetId) {
      return null;
    }
    return `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}`;
  }
}
