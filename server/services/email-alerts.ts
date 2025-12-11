import { getGmailClient } from './gmail-client-oauth.js';
import { storage } from '../storage';

interface AlertEmailData {
  type: 'diagnostic_failure' | 'capture_failure' | 'camera_offline' | 'test_alert' | 'missing_tool';
  subject: string;
  details: {
    timestamp: string;
    cameraName?: string;
    cameraId?: string; // Changed to string to match database UUID format
    errorMessage?: string;
    failedCameras?: number;
    totalCameras?: number;
    slotsProcessed?: number;
    failureCount?: number;
    // Missing tool alert fields
    slotNumber?: number;
    toolName?: string;
    slotId?: string;
  };
}

function buildAlertSubject(alertData: AlertEmailData): string {
  const { type, details } = alertData;
  
  // Alert type labels in Japanese
  const alertTypeLabels: Record<string, string> = {
    diagnostic_failure: '診断チェック失敗',
    capture_failure: '撮影失敗',
    camera_offline: 'カメラ異常',
    test_alert: 'テスト通知',
    missing_tool: '工具不足'
  };
  
  const typeLabel = alertTypeLabels[type] || type.replace(/_/g, ' ');
  
  // For missing tool alerts, include camera name and tool name
  if (type === 'missing_tool' && details.cameraName && details.toolName) {
    return `【工具管理システム】${details.cameraName} - ${details.toolName} 不足`;
  }
  
  // For all other alerts, include camera name if available
  if (details.cameraName) {
    return `【工具管理システム】${details.cameraName} - ${typeLabel}`;
  }
  
  // Fallback for alerts without camera name
  return alertData.subject || `【工具管理システム】${typeLabel}`;
}

export async function sendAlertEmail(alertData: AlertEmailData): Promise<boolean> {
  try {
    // Get email recipients from system config
    const alertEmailsConfig = await storage.getConfigByKey('EMAIL_RECIPIENTS');
    
    if (!alertEmailsConfig || !alertEmailsConfig.value) {
      console.log('[Email Alert] No alert email recipients configured');
      return false;
    }

    const recipients = typeof alertEmailsConfig.value === 'string' 
      ? JSON.parse(alertEmailsConfig.value) 
      : alertEmailsConfig.value;
    if (!recipients || recipients.length === 0) {
      console.log('[Email Alert] No alert email recipients configured');
      return false;
    }

    // Build email content
    const subject = buildAlertSubject(alertData);
    const emailBody = buildEmailBody(alertData);
    const htmlBody = buildHtmlEmailBody(alertData);

    // Get Gmail client (uses OAuth2 with auto token refresh)
    const gmail = await getGmailClient();

    // Send to each recipient
    for (const recipient of recipients) {
      const message = [
        `To: ${recipient}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${subject}`,
        '',
        htmlBody
      ].join('\n');

      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      console.log(`[Email Alert] Sent ${alertData.type} alert to ${recipient}`);
    }

    return true;
  } catch (error) {
    console.error('[Email Alert] Failed to send email:', error);
    return false;
  }
}

function buildEmailBody(alertData: AlertEmailData): string {
  const { type, details } = alertData;
  
  // Alert type labels in Japanese
  const alertTypeLabels: Record<string, string> = {
    diagnostic_failure: '診断チェック失敗',
    capture_failure: '撮影失敗',
    camera_offline: 'カメラ異常',
    test_alert: 'テスト通知',
    missing_tool: '工具不足'
  };
  
  const typeLabel = alertTypeLabels[type] || type.replace(/_/g, ' ').toUpperCase();
  
  let body = `工具管理システム通知\n\n`;
  
  // Show camera name prominently at the top for all alerts
  if (details.cameraName) {
    body += `カメラ: ${details.cameraName}\n`;
  }
  if (details.cameraId) {
    body += `カメラID: ${details.cameraId}\n`;
  }
  
  body += `通知種別: ${typeLabel}\n`;
  body += `日時: ${details.timestamp}\n\n`;

  if (type === 'diagnostic_failure') {
    body += `事前診断チェックが失敗しました。\n`;
    if (details.errorMessage) {
      body += `エラー内容: ${details.errorMessage}\n`;
    }
  } else if (type === 'capture_failure') {
    body += `定時撮影が失敗しました。\n`;
    if (details.failedCameras !== undefined && details.totalCameras !== undefined) {
      body += `失敗カメラ数: ${details.failedCameras}/${details.totalCameras}\n`;
    }
    if (details.slotsProcessed !== undefined) {
      body += `処理済みスロット数: ${details.slotsProcessed}\n`;
    }
    if (details.errorMessage) {
      body += `エラー内容: ${details.errorMessage}\n`;
    }
  } else if (type === 'camera_offline') {
    body += `カメラがオフラインまたはアクセス不可の状態です。\n`;
    if (details.errorMessage) {
      body += `エラー内容: ${details.errorMessage}\n`;
    }
  } else if (type === 'missing_tool') {
    body += `指定スロットから工具が不足しています。\n`;
    if (details.slotNumber) {
      body += `スロット番号: ${details.slotNumber}\n`;
    }
    if (details.toolName) {
      body += `不足工具: ${details.toolName}\n`;
    }
    if (details.slotId) {
      body += `スロットID: ${details.slotId}\n`;
    }
  }

  body += `\n---\nこのメールは工具管理システムから自動送信されています。`;
  return body;
}

function buildHtmlEmailBody(alertData: AlertEmailData): string {
  const { type, details } = alertData;
  
  const alertColors = {
    diagnostic_failure: '#f59e0b',
    capture_failure: '#ef4444',
    camera_offline: '#dc2626',
    test_alert: '#3b82f6',
    missing_tool: '#dc2626'
  };
  
  // Alert type labels in Japanese
  const alertTypeLabels: Record<string, string> = {
    diagnostic_failure: '診断チェック失敗',
    capture_failure: '撮影失敗',
    camera_offline: 'カメラ異常',
    test_alert: 'テスト通知',
    missing_tool: '工具不足'
  };

  const color = alertColors[type] || '#6b7280';
  const typeLabel = alertTypeLabels[type] || type.replace(/_/g, ' ');

  // Build camera info section (shown for all non-test alerts)
  let cameraInfoHtml = '';
  if (type !== 'test_alert' && (details.cameraName || details.cameraId)) {
    cameraInfoHtml = `
      <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
        ${details.cameraName ? `<p style="margin: 5px 0; font-weight: bold; color: #1e40af;">カメラ: ${details.cameraName}</p>` : ''}
        ${details.cameraId ? `<p style="margin: 5px 0; font-size: 12px; color: #6b7280;">カメラID: ${details.cameraId}</p>` : ''}
      </div>
    `;
  }

  let detailsHtml = '';
  
  if (type === 'diagnostic_failure') {
    detailsHtml = `
      <p style="margin: 10px 0;">事前診断チェックが失敗しました。</p>
      ${details.errorMessage ? `<p style="margin: 5px 0; color: #dc2626;"><strong>エラー内容:</strong> ${details.errorMessage}</p>` : ''}
    `;
  } else if (type === 'capture_failure') {
    detailsHtml = `
      <p style="margin: 10px 0;">定時撮影が失敗しました。</p>
      ${details.failedCameras !== undefined && details.totalCameras !== undefined ? 
        `<p style="margin: 5px 0;"><strong>失敗カメラ数:</strong> ${details.failedCameras}/${details.totalCameras}</p>` : ''}
      ${details.slotsProcessed !== undefined ? 
        `<p style="margin: 5px 0;"><strong>処理済みスロット数:</strong> ${details.slotsProcessed}</p>` : ''}
      ${details.failureCount !== undefined ? 
        `<p style="margin: 5px 0; color: #dc2626;"><strong>失敗件数:</strong> ${details.failureCount}</p>` : ''}
      ${details.errorMessage ? `<p style="margin: 5px 0; color: #dc2626;"><strong>エラー内容:</strong> ${details.errorMessage}</p>` : ''}
    `;
  } else if (type === 'camera_offline') {
    detailsHtml = `
      <p style="margin: 10px 0;">カメラがオフラインまたはアクセス不可の状態です。</p>
      ${details.errorMessage ? `<p style="margin: 5px 0; color: #dc2626;"><strong>エラー内容:</strong> ${details.errorMessage}</p>` : ''}
    `;
  } else if (type === 'missing_tool') {
    detailsHtml = `
      <p style="margin: 10px 0; font-size: 16px; font-weight: bold; color: #dc2626;">指定スロットから工具が不足しています</p>
      ${details.toolName ? `<p style="margin: 10px 0;"><strong>不足工具:</strong> <span style="color: #dc2626; font-size: 18px;">${details.toolName}</span></p>` : ''}
      ${details.slotNumber ? `<p style="margin: 5px 0;"><strong>スロット番号:</strong> ${details.slotNumber}</p>` : ''}
      ${details.slotId ? `<p style="margin: 5px 0; font-size: 12px; color: #6b7280;">スロットID: ${details.slotId}</p>` : ''}
    `;
  } else if (type === 'test_alert') {
    detailsHtml = `<p style="margin: 10px 0;">これはメール設定の動作確認用テスト通知です。</p>`;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 20px; background-color: #f3f4f6;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden;">
        <div style="background-color: ${color}; color: white; padding: 20px;">
          <h1 style="margin: 0; font-size: 24px; font-weight: bold;">工具管理システム通知</h1>
        </div>
        <div style="padding: 30px;">
          <div style="background-color: #fef3c7; border-left: 4px solid ${color}; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; font-weight: bold; color: #92400e;">通知種別: ${typeLabel}</p>
          </div>
          
          <p style="margin: 10px 0; color: #6b7280;"><strong>日時:</strong> ${details.timestamp}</p>
          
          ${cameraInfoHtml}
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            ${detailsHtml}
          </div>
        </div>
        <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 12px; color: #6b7280;">このメールは工具管理システムから自動送信されています</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function sendTestAlert(): Promise<boolean> {
  const now = new Date();
  const timestamp = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  return sendAlertEmail({
    type: 'test_alert',
    subject: '【工具管理システム】テスト通知',
    details: {
      timestamp
    }
  });
}
