import { getUncachableGmailClient } from './gmail-client';
import { storage } from '../storage';

interface AlertEmailData {
  type: 'diagnostic_failure' | 'capture_failure' | 'camera_offline' | 'test_alert';
  subject: string;
  details: {
    timestamp: string;
    cameraName?: string;
    cameraId?: number;
    errorMessage?: string;
    failedCameras?: number;
    totalCameras?: number;
    slotsProcessed?: number;
    failureCount?: number;
  };
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
    const emailBody = buildEmailBody(alertData);
    const htmlBody = buildHtmlEmailBody(alertData);

    // Get Gmail client
    const gmail = await getUncachableGmailClient();

    // Send to each recipient
    for (const recipient of recipients) {
      const message = [
        `To: ${recipient}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${alertData.subject}`,
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
  
  let body = `Tool Tracking System Alert\n\n`;
  body += `Alert Type: ${type.replace(/_/g, ' ').toUpperCase()}\n`;
  body += `Timestamp: ${details.timestamp}\n\n`;

  if (type === 'diagnostic_failure') {
    body += `Pre-flight diagnostic check failed.\n`;
    if (details.cameraName) {
      body += `Camera: ${details.cameraName}\n`;
    }
    if (details.errorMessage) {
      body += `Error: ${details.errorMessage}\n`;
    }
  } else if (type === 'capture_failure') {
    body += `Scheduled capture failed.\n`;
    if (details.failedCameras !== undefined && details.totalCameras !== undefined) {
      body += `Failed Cameras: ${details.failedCameras}/${details.totalCameras}\n`;
    }
    if (details.slotsProcessed !== undefined) {
      body += `Slots Processed: ${details.slotsProcessed}\n`;
    }
    if (details.errorMessage) {
      body += `Error: ${details.errorMessage}\n`;
    }
  } else if (type === 'camera_offline') {
    body += `Camera is offline or inaccessible.\n`;
    if (details.cameraName) {
      body += `Camera: ${details.cameraName}\n`;
    }
    if (details.errorMessage) {
      body += `Error: ${details.errorMessage}\n`;
    }
  }

  body += `\n---\nThis is an automated alert from your Tool Tracking System.`;
  return body;
}

function buildHtmlEmailBody(alertData: AlertEmailData): string {
  const { type, details } = alertData;
  
  const alertColors = {
    diagnostic_failure: '#f59e0b',
    capture_failure: '#ef4444',
    camera_offline: '#dc2626',
    test_alert: '#3b82f6'
  };

  const color = alertColors[type] || '#6b7280';

  let detailsHtml = '';
  
  if (type === 'diagnostic_failure') {
    detailsHtml = `
      <p style="margin: 10px 0;">Pre-flight diagnostic check failed.</p>
      ${details.cameraName ? `<p style="margin: 5px 0;"><strong>Camera:</strong> ${details.cameraName}</p>` : ''}
      ${details.errorMessage ? `<p style="margin: 5px 0; color: #dc2626;"><strong>Error:</strong> ${details.errorMessage}</p>` : ''}
    `;
  } else if (type === 'capture_failure') {
    detailsHtml = `
      <p style="margin: 10px 0;">Scheduled capture failed.</p>
      ${details.failedCameras !== undefined && details.totalCameras !== undefined ? 
        `<p style="margin: 5px 0;"><strong>Failed Cameras:</strong> ${details.failedCameras}/${details.totalCameras}</p>` : ''}
      ${details.slotsProcessed !== undefined ? 
        `<p style="margin: 5px 0;"><strong>Slots Processed:</strong> ${details.slotsProcessed}</p>` : ''}
      ${details.failureCount !== undefined ? 
        `<p style="margin: 5px 0; color: #dc2626;"><strong>Failures:</strong> ${details.failureCount}</p>` : ''}
      ${details.errorMessage ? `<p style="margin: 5px 0; color: #dc2626;"><strong>Error:</strong> ${details.errorMessage}</p>` : ''}
    `;
  } else if (type === 'camera_offline') {
    detailsHtml = `
      <p style="margin: 10px 0;">Camera is offline or inaccessible.</p>
      ${details.cameraName ? `<p style="margin: 5px 0;"><strong>Camera:</strong> ${details.cameraName}</p>` : ''}
      ${details.errorMessage ? `<p style="margin: 5px 0; color: #dc2626;"><strong>Error:</strong> ${details.errorMessage}</p>` : ''}
    `;
  } else if (type === 'test_alert') {
    detailsHtml = `<p style="margin: 10px 0;">This is a test alert to verify your email configuration is working correctly.</p>`;
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
          <h1 style="margin: 0; font-size: 24px; font-weight: bold;">🔧 Tool Tracking System Alert</h1>
        </div>
        <div style="padding: 30px;">
          <div style="background-color: #fef3c7; border-left: 4px solid ${color}; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; font-weight: bold; color: #92400e;">Alert Type: ${type.replace(/_/g, ' ').toUpperCase()}</p>
          </div>
          
          <p style="margin: 10px 0; color: #6b7280;"><strong>Timestamp:</strong> ${details.timestamp}</p>
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            ${detailsHtml}
          </div>
        </div>
        <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 12px; color: #6b7280;">This is an automated alert from your Tool Tracking System</p>
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
    subject: '🧪 Tool Tracker - Test Alert',
    details: {
      timestamp
    }
  });
}
