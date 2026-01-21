/**
 * Utility functions for parsing config values safely
 */

/**
 * Parse a config value as a boolean, handling both string and boolean inputs.
 * This is critical because config values stored in DB may be strings like "true"/"false"
 * but code may expect actual booleans.
 * 
 * @param value - The config value (string, boolean, null, or undefined)
 * @param fallback - Default value if parsing fails (default: false)
 * @returns Properly parsed boolean value
 */
export function parseBoolConfigValue(value: unknown, fallback: boolean = false): boolean {
  if (value === null || value === undefined) {
    return fallback;
  }
  
  if (typeof value === 'boolean') {
    return value;
  }
  
  if (typeof value === 'string') {
    const normalized = value.toLowerCase().trim();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
    console.warn(`[config-utils] Unexpected boolean string value: "${value}", using fallback: ${fallback}`);
    return fallback;
  }
  
  console.warn(`[config-utils] Unexpected type for boolean config: ${typeof value}, using fallback: ${fallback}`);
  return fallback;
}

/**
 * Stringify a boolean value for storage in the config table.
 * Ensures consistent storage format across the application.
 * 
 * @param value - Boolean value to stringify
 * @returns "true" or "false" string
 */
export function stringifyBoolConfigValue(value: boolean): string {
  return value ? 'true' : 'false';
}
