# Google OAuth2 Setup Guide for ShelfEye Tool Monitoring System

This guide explains how to configure Google OAuth2 credentials to enable Gmail alerts and Google Sheets logging in your ShelfEye system running on Raspberry Pi.

## Overview

ShelfEye uses Google OAuth2 to send alert emails via Gmail and log detection events to Google Sheets. This setup is required once and works standalone on your Raspberry Pi without any Replit dependencies.

## Prerequisites

- A Google account (can be a Gmail account or Google Workspace account)
- Access to Google Cloud Console
- Your ShelfEye system URL or IP address (e.g., `http://192.168.1.100:5000` or your Replit deployment URL)

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Enter project name: `ShelfEye Tool Monitoring` (or any name you prefer)
4. Click **Create**
5. Wait for the project to be created and select it

## Step 2: Enable Required APIs

1. In your Google Cloud project, go to **APIs & Services** → **Library**
2. Search for and enable the following APIs:
   - **Gmail API**: Click **Enable**
   - **Google Sheets API**: Click **Enable**

## Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** user type (unless you have a Google Workspace account and want to use Internal)
3. Click **Create**
4. Fill in the required fields:
   - **App name**: `ShelfEye Tool Monitoring`
   - **User support email**: Your email address
   - **Developer contact information**: Your email address
5. Click **Save and Continue**
6. On **Scopes** page: Click **Save and Continue** (don't add scopes manually, they'll be added automatically)
7. On **Test users** page:
   - Click **Add Users**
   - Add your Gmail/Google Workspace email address
   - Click **Save and Continue**
8. Review and click **Back to Dashboard**

## Step 4: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Select **Application type**: **Web application**
4. Enter **Name**: `ShelfEye Web Client`
5. Under **Authorized redirect URIs**, click **Add URI** and enter:
   - For local Raspberry Pi: `http://YOUR_PI_IP:5000/api/oauth/google/callback`
   - For Replit dev: `https://YOUR_REPL_URL/api/oauth/google/callback`
   - Example: `http://192.168.1.100:5000/api/oauth/google/callback`
   
   **Important**: Use the exact URL where your ShelfEye system is accessible. The redirect URI must match exactly.

6. Click **Create**
7. A dialog will appear with your **Client ID** and **Client Secret**
8. **Copy both values** - you'll need them in the next step

## Step 5: Configure ShelfEye OAuth Settings

1. Open your ShelfEye web interface
2. Navigate to **Google OAuth Setup** page (accessible from the configuration menu)
3. Enter the credentials from Step 4:
   - **Client ID**: Paste your OAuth 2.0 Client ID
   - **Client Secret**: Paste your OAuth 2.0 Client Secret
   - **Redirect URI**: Enter the same URI you used in Step 4 (e.g., `http://192.168.1.100:5000/api/oauth/google/callback`)
4. Click **Save Credentials**

## Step 6: Authorize ShelfEye

1. After saving credentials, you'll see the **Authorization** section
2. Click **Start Authorization**
3. You'll be redirected to Google's authorization page
4. Sign in with the Google account you added as a test user in Step 3
5. Review the permissions ShelfEye is requesting:
   - **Gmail API**: Send emails on your behalf
   - **Google Sheets API**: Create and edit spreadsheets
6. Click **Allow**
7. You'll be redirected back to ShelfEye
8. If successful, you'll see "✅ OAuth is configured and working"

## Step 7: Test the Integration

1. In the ShelfEye configuration page, go to **Alerts** settings
2. Add your email address as an alert recipient
3. Click **Send Test Email** to verify Gmail integration
4. Check your inbox for the test email
5. Go to **Scheduler** settings and verify Google Sheets logging is enabled
6. Check your Google Drive for a new spreadsheet created by ShelfEye

## Troubleshooting

### "Access blocked: This app's request is invalid"
- Verify your redirect URI in Google Cloud Console exactly matches what you entered in ShelfEye
- Ensure you're using `http://` (not `https://`) for local Raspberry Pi deployments
- Check that the port number is correct (default: 5000)

### "403: access_denied"
- Verify you added your email as a test user in the OAuth consent screen
- Make sure you're signing in with the correct Google account

### "Invalid grant" error
- Your refresh token may have expired
- Go back to Step 6 and re-authorize the application

### Gmail not sending emails
- Verify Gmail API is enabled in Google Cloud Console
- Check that your email address is configured in ShelfEye alert settings
- Look at the browser console or server logs for error messages

### Google Sheets not logging
- Verify Google Sheets API is enabled in Google Cloud Console
- Check that sheets logging is enabled in ShelfEye scheduler settings
- Verify the spreadsheet ID in your configuration (or leave empty for auto-creation)

## Security Notes

- **Client Secret**: Keep this confidential. It's stored encrypted in your local database.
- **Refresh Token**: Automatically managed by ShelfEye and stored securely in the database.
- **Token Refresh**: ShelfEye automatically refreshes expired access tokens using the stored refresh token.
- **Revoke Access**: To revoke ShelfEye's access, go to [Google Account Permissions](https://myaccount.google.com/permissions) and remove "ShelfEye Tool Monitoring"

## Production Deployment

When publishing your OAuth app to production:

1. Go to **OAuth consent screen** in Google Cloud Console
2. Click **Publish App** to move from Testing to Production
3. Submit for Google verification if required (depends on scopes used)
4. Update **Authorized redirect URIs** to include your production URL

## Technical Details

- **Scopes used**:
  - `https://www.googleapis.com/auth/gmail.send` - Send emails
  - `https://www.googleapis.com/auth/spreadsheets` - Manage spreadsheets
- **Token storage**: Refresh tokens are stored in the `google_oauth_credentials` table
- **Token refresh**: Automatic, handled by googleapis client library
- **Offline access**: Yes, using refresh tokens for unattended operation

## Support

If you encounter issues not covered in this guide:
1. Check the browser console for errors
2. Check server logs: `npm run dev` output
3. Verify all steps were completed in order
4. Ensure your Google account has necessary permissions

---

**Last Updated**: October 2025  
**System Version**: ShelfEye v2.0 (OAuth-enabled)
