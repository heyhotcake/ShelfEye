import { google } from 'googleapis';
import { storage } from '../storage';

export async function getGmailClient() {
  const credential = await storage.getGoogleOAuthCredential('gmail');
  
  if (!credential || !credential.isConfigured || !credential.refreshToken) {
    throw new Error('Gmail OAuth2 not configured. Please complete OAuth setup.');
  }

  // Check if access token is expired or missing
  const now = new Date();
  const needsRefresh = !credential.accessToken || 
                       !credential.expiresAt || 
                       credential.expiresAt <= now;

  if (needsRefresh) {
    // Refresh the access token
    const oauth2Client = new google.auth.OAuth2(
      credential.clientId,
      credential.clientSecret,
      credential.redirectUri
    );

    oauth2Client.setCredentials({
      refresh_token: credential.refreshToken
    });

    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      // Update storage with new access token
      await storage.setGoogleOAuthCredential('gmail', {
        accessToken: credentials.access_token!,
        expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined
      });

      oauth2Client.setCredentials(credentials);
      return google.gmail({ version: 'v1', auth: oauth2Client });
    } catch (error) {
      console.error('[Gmail OAuth] Token refresh failed:', error);
      throw new Error('Failed to refresh Gmail access token');
    }
  } else {
    // Use existing access token
    const oauth2Client = new google.auth.OAuth2(
      credential.clientId,
      credential.clientSecret,
      credential.redirectUri
    );

    oauth2Client.setCredentials({
      access_token: credential.accessToken,
      refresh_token: credential.refreshToken
    });

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }
}

export async function getGmailOAuthUrl(): Promise<string> {
  const credential = await storage.getGoogleOAuthCredential('gmail');
  
  if (!credential || !credential.clientId || !credential.clientSecret) {
    throw new Error('Gmail OAuth2 client credentials not configured');
  }

  const oauth2Client = new google.auth.OAuth2(
    credential.clientId,
    credential.clientSecret,
    credential.redirectUri
  );

  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: 'gmail' // To identify which service this is for
  });
}

export async function handleGmailOAuthCallback(code: string): Promise<void> {
  const credential = await storage.getGoogleOAuthCredential('gmail');
  
  if (!credential || !credential.clientId || !credential.clientSecret) {
    throw new Error('Gmail OAuth2 client credentials not configured');
  }

  const oauth2Client = new google.auth.OAuth2(
    credential.clientId,
    credential.clientSecret,
    credential.redirectUri
  );

  const { tokens } = await oauth2Client.getToken(code);
  
  await storage.setGoogleOAuthCredential('gmail', {
    refreshToken: tokens.refresh_token!,
    accessToken: tokens.access_token!,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    isConfigured: true
  });
}
