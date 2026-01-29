/**
 * Environment variable validation at startup
 * Ensures all required configuration is present before the app starts
 */

interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEnvironment(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required environment variables
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is required for database connection');
  }

  // API key is optional - secure local network deployments don't require it
  // Set SHELFEYE_API_KEY to enable Bearer token authentication for external access
  if (!process.env.SHELFEYE_API_KEY) {
    warnings.push('SHELFEYE_API_KEY not set - API endpoints are NOT protected. Set this for external network access.');
  }

  // Check Google integration availability (optional but recommended for alerts)
  const hasGmailIntegration = process.env.REPLIT_CONNECTORS_HOSTNAME || 
    (process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL);
  
  if (!hasGmailIntegration) {
    warnings.push('Google Mail integration not detected - email alerts will not work');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function logValidationResults(result: EnvValidationResult): void {
  console.log('[Startup] Environment validation...');
  
  if (result.errors.length > 0) {
    console.error('[Startup] ❌ CRITICAL ERRORS:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
  }
  
  if (result.warnings.length > 0) {
    console.warn('[Startup] ⚠️ Warnings:');
    for (const warning of result.warnings) {
      console.warn(`  - ${warning}`);
    }
  }
  
  if (result.valid && result.warnings.length === 0) {
    console.log('[Startup] ✓ Environment validation passed');
  } else if (result.valid) {
    console.log('[Startup] ✓ Environment validation passed with warnings');
  }
}

export function validateAndExit(): void {
  const result = validateEnvironment();
  logValidationResults(result);
  
  if (!result.valid) {
    console.error('[Startup] Cannot start - fix the above errors and restart');
    process.exit(1);
  }
}
