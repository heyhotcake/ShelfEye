import { getUncachableGoogleSheetClient } from './sheets-client';
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

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  async initialize() {
    const config = await this.storage.getConfigByKey('SHEETS_SPREADSHEET_ID');
    this.spreadsheetId = config?.value as string || null;

    if (!this.spreadsheetId) {
      console.log('[SheetsLogger] No spreadsheet ID configured, will create new spreadsheet on first log');
    }
  }

  async ensureSpreadsheet(): Promise<string> {
    if (this.spreadsheetId) {
      return this.spreadsheetId;
    }

    try {
      const sheets = await getUncachableGoogleSheetClient();
      
      const response = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: `Tool Tracker Alert Log - ${new Date().toISOString().split('T')[0]}`,
          },
          sheets: [
            {
              properties: {
                title: 'Alert Log',
              },
              data: [
                {
                  startRow: 0,
                  startColumn: 0,
                  rowData: [
                    {
                      values: [
                        { userEnteredValue: { stringValue: 'Timestamp' } },
                        { userEnteredValue: { stringValue: 'Alert Type' } },
                        { userEnteredValue: { stringValue: 'Status' } },
                        { userEnteredValue: { stringValue: 'Camera ID' } },
                        { userEnteredValue: { stringValue: 'Slot ID' } },
                        { userEnteredValue: { stringValue: 'Error Message' } },
                        { userEnteredValue: { stringValue: 'Details' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      this.spreadsheetId = response.data.spreadsheetId || null;
      
      if (this.spreadsheetId) {
        await this.storage.setConfig('SHEETS_SPREADSHEET_ID', this.spreadsheetId, 'Google Sheets ID for alert logging');
        console.log(`[SheetsLogger] Created new spreadsheet: ${this.spreadsheetId}`);
      }

      return this.spreadsheetId!;
    } catch (error) {
      console.error('[SheetsLogger] Failed to create spreadsheet:', error);
      throw error;
    }
  }

  async logAlert(entry: SheetsLogEntry): Promise<void> {
    try {
      const spreadsheetId = await this.ensureSpreadsheet();
      const sheets = await getUncachableGoogleSheetClient();

      const values = [
        [
          entry.timestamp,
          entry.alertType,
          entry.status,
          entry.cameraId || '',
          entry.slotId || '',
          entry.errorMessage || '',
          entry.details ? JSON.stringify(entry.details) : '',
        ],
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Alert Log!A:G',
        valueInputOption: 'RAW',
        requestBody: {
          values,
        },
      });

      console.log(`[SheetsLogger] Logged alert: ${entry.alertType} at ${entry.timestamp}`);
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
