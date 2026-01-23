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
  
  // For missing tool alerts, include camera name and tool name
  if (type === 'missing_tool' && details.cameraName && details.toolName) {
    return `🔧 Tool Alert - ${details.cameraName} - ${details.toolName} Missing`;
  }
  
  // For all other alerts, include camera name if available
  if (details.cameraName) {
    const alertType = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `⚠️ System Alert - ${details.cameraName} - ${alertType}`;
  }
  
  // Fallback for alerts without camera name
  return alertData.subject || `Tool Tracking System - ${type.replace(/_/g, ' ')}`;
}

export async function sendAlertEmail(alertData: AlertEmailData): Promise<boolean> {
  try {
    // Get email recipients from system config
    const alertEmailsConfig = await storage.getConfigByKey('EMAIL_RECIPIENTS');
    
    if (!alertEmailsConfig || !alertEmailsConfig.value) {
      console.log('[Email Alert] No alert email recipients configured');
      return false;
    }

    const rawRecipients: string[] = typeof alertEmailsConfig.value === 'string' 
      ? JSON.parse(alertEmailsConfig.value) 
      : alertEmailsConfig.value;
    if (!rawRecipients || rawRecipients.length === 0) {
      console.log('[Email Alert] No alert email recipients configured');
      return false;
    }
    
    // Deduplicate recipients to prevent sending duplicate emails
    const recipients = [...new Set(rawRecipients)];
    if (recipients.length !== rawRecipients.length) {
      console.log(`[Email Alert] Deduplicated recipients: ${rawRecipients.length} -> ${recipients.length}`);
    }

    // Build email content
    const subject = buildAlertSubject(alertData);
    const emailBody = buildEmailBody(alertData);
    const htmlBody = buildHtmlEmailBody(alertData);

    // Get Gmail client (uses OAuth2 with auto token refresh)
    const gmail = await getGmailClient();
    
    // RFC 2047 encode subject for proper UTF-8/emoji support in email headers
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;

    // Send to each recipient
    for (const recipient of recipients) {
      const message = [
        `To: ${recipient}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${encodedSubject}`,
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
  
  // Show camera name prominently at the top for all alerts
  if (details.cameraName) {
    body += `Camera: ${details.cameraName}\n`;
  }
  if (details.cameraId) {
    body += `Camera ID: ${details.cameraId}\n`;
  }
  
  body += `Alert Type: ${type.replace(/_/g, ' ').toUpperCase()}\n`;
  body += `Timestamp: ${details.timestamp}\n\n`;

  if (type === 'diagnostic_failure') {
    body += `Pre-flight diagnostic check failed.\n`;
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
    if (details.errorMessage) {
      body += `Error: ${details.errorMessage}\n`;
    }
  } else if (type === 'missing_tool') {
    body += `Tool is missing from its designated slot.\n`;
    if (details.slotNumber) {
      body += `Slot Number: ${details.slotNumber}\n`;
    }
    if (details.toolName) {
      body += `Missing Tool: ${details.toolName}\n`;
    }
    if (details.slotId) {
      body += `Slot ID: ${details.slotId}\n`;
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
    test_alert: '#3b82f6',
    missing_tool: '#dc2626'
  };

  const color = alertColors[type] || '#6b7280';

  // Build camera info section (shown for all non-test alerts)
  let cameraInfoHtml = '';
  if (type !== 'test_alert' && (details.cameraName || details.cameraId)) {
    cameraInfoHtml = `
      <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
        ${details.cameraName ? `<p style="margin: 5px 0; font-weight: bold; color: #1e40af;">📷 Camera: ${details.cameraName}</p>` : ''}
        ${details.cameraId ? `<p style="margin: 5px 0; font-size: 12px; color: #6b7280;">ID: ${details.cameraId}</p>` : ''}
      </div>
    `;
  }

  let detailsHtml = '';
  
  if (type === 'diagnostic_failure') {
    detailsHtml = `
      <p style="margin: 10px 0;">Pre-flight diagnostic check failed.</p>
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
      ${details.errorMessage ? `<p style="margin: 5px 0; color: #dc2626;"><strong>Error:</strong> ${details.errorMessage}</p>` : ''}
    `;
  } else if (type === 'missing_tool') {
    detailsHtml = `
      <p style="margin: 10px 0; font-size: 16px; font-weight: bold; color: #dc2626;">🔧 Tool is missing from its designated slot!</p>
      ${details.toolName ? `<p style="margin: 10px 0;"><strong>Missing Tool:</strong> <span style="color: #dc2626; font-size: 18px;">${details.toolName}</span></p>` : ''}
      ${details.slotNumber ? `<p style="margin: 5px 0;"><strong>Slot Number:</strong> ${details.slotNumber}</p>` : ''}
      ${details.slotId ? `<p style="margin: 5px 0; font-size: 12px; color: #6b7280;">Slot ID: ${details.slotId}</p>` : ''}
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
          
          ${cameraInfoHtml}
          
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
