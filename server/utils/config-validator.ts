import { IStorage } from '../storage';

interface ConfigValidation {
  key: string;
  required: boolean;
  type: 'string' | 'json' | 'number' | 'boolean' | 'email' | 'array';
  description: string;
  validator?: (value: any) => boolean; // Runs on PARSED value, not raw string
}

const REQUIRED_CONFIG: ConfigValidation[] = [
  // Scheduler
  { key: 'capture_times', required: true, type: 'json', description: 'Scheduled capture times array' },
  { key: 'timezone', required: true, type: 'string', description: 'System timezone (e.g., Asia/Tokyo)' },
  { key: 'scheduler_paused', required: true, type: 'string', description: 'Scheduler pause state' },
  
  // Email & Alerts
  { key: 'EMAIL_RECIPIENTS', required: true, type: 'array', description: 'Alert recipient email addresses' },
  { key: 'smtp_host', required: true, type: 'string', description: 'SMTP server host' },
  { key: 'smtp_port', required: true, type: 'number', description: 'SMTP server port' },
  { key: 'smtp_user', required: false, type: 'string', description: 'SMTP username' },
  { key: 'smtp_pass', required: false, type: 'string', description: 'SMTP password' },
  { key: 'smtp_from', required: true, type: 'email', description: 'Email sender address' },
  { key: 'alert_email', required: false, type: 'string', description: 'Alert recipient email (single)' },
  { key: 'ALERT_TEMPLATES', required: true, type: 'json', description: 'Alert email templates' },
  
  // Google Sheets
  { key: 'google_sheets_url', required: false, type: 'string', description: 'Google Sheets logging URL' },
  { key: 'SHEETS_SPREADSHEET_ID', required: false, type: 'string', description: 'Google Sheets spreadsheet ID' },
  { key: 'SHEETS_FORMATTING', required: true, type: 'json', description: 'Google Sheets formatting options' },
  
  // GPIO Pins
  { key: 'buzzer_gpio_pin', required: true, type: 'number', description: 'Buzzer GPIO pin' },
  { key: 'led_gpio_pin', required: true, type: 'number', description: 'LED GPIO pin' },
  { key: 'light_strip_gpio_pin', required: true, type: 'number', description: 'LED strip GPIO pin' },
  { key: 'alert_led_gpio_pin', required: true, type: 'number', description: 'Alert LED GPIO pin' },
  
  // LED Strip Configuration
  { key: 'led_strip_num_leds', required: true, type: 'string', description: 'Number of LEDs in strip',
    validator: (val) => !isNaN(parseInt(val)) && parseInt(val) > 0 },
  { key: 'led_strip_brightness', required: true, type: 'string', description: 'LED brightness (0-255)',
    validator: (val) => !isNaN(parseInt(val)) && parseInt(val) >= 0 && parseInt(val) <= 255 },
  
  // Calibration
  { key: 'calibration-info', required: true, type: 'json', description: 'Camera calibration metadata' },
  { key: 'last_calibration_paper_size_format', required: true, type: 'string', description: 'Last used paper size' },
  { key: 'last_calibration_camera_id', required: false, type: 'string', description: 'Last calibrated camera ID' },
  { key: 'last_calibration_timestamp', required: false, type: 'string', description: 'Last calibration timestamp' },
];

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    total: number;
    present: number;
    missing: number;
    invalid: number;
  };
}

export async function validateConfiguration(storage: IStorage): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let present = 0;
  let missing = 0;
  let invalid = 0;

  console.log('[ConfigValidator] Starting configuration validation...');

  for (const config of REQUIRED_CONFIG) {
    const value = await storage.getConfigByKey(config.key);

    if (!value || value.value === null || value.value === undefined) {
      if (config.required) {
        errors.push(`❌ Missing required config: ${config.key} - ${config.description}`);
        missing++;
      } else {
        warnings.push(`⚠️  Optional config not set: ${config.key} - ${config.description}`);
        missing++;
      }
      continue;
    }

    // Validate type and parse value
    const val = value.value;
    let typeValid = true;
    let parsedValue = val; // Will hold parsed version for custom validators

    switch (config.type) {
      case 'json':
        try {
          if (typeof val === 'string') {
            parsedValue = JSON.parse(val);
          } else if (typeof val !== 'object') {
            typeValid = false;
          } else {
            parsedValue = val;
          }
        } catch (e) {
          typeValid = false;
          errors.push(`❌ Invalid JSON in ${config.key}: ${String(e)}`);
          invalid++;
        }
        break;
      
      case 'number':
        if (typeof val !== 'number' && isNaN(Number(val))) {
          typeValid = false;
          errors.push(`❌ ${config.key} must be a number, got: ${typeof val}`);
          invalid++;
        } else {
          parsedValue = typeof val === 'number' ? val : Number(val);
        }
        break;
      
      case 'boolean':
        if (typeof val !== 'boolean' && val !== 'true' && val !== 'false') {
          typeValid = false;
          errors.push(`❌ ${config.key} must be boolean, got: ${val}`);
          invalid++;
        } else {
          parsedValue = typeof val === 'boolean' ? val : val === 'true';
        }
        break;
      
      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (typeof val === 'string' && !emailRegex.test(val)) {
          warnings.push(`⚠️  ${config.key} may not be a valid email: ${val}`);
        }
        parsedValue = val;
        break;
      
      case 'array':
        try {
          parsedValue = typeof val === 'string' ? JSON.parse(val) : val;
          if (!Array.isArray(parsedValue)) {
            typeValid = false;
            errors.push(`❌ ${config.key} must be an array (or JSON array string), got: ${typeof parsedValue}`);
            invalid++;
          }
        } catch (e) {
          typeValid = false;
          errors.push(`❌ ${config.key} must be a valid JSON array: ${String(e)}`);
          invalid++;
        }
        break;
      
      case 'string':
      default:
        parsedValue = val;
        break;
    }

    // Custom validator - runs on PARSED value, not raw
    if (typeValid && config.validator) {
      if (!config.validator(parsedValue)) {
        errors.push(`❌ ${config.key} failed custom validation`);
        invalid++;
        typeValid = false;
      }
    }

    if (typeValid) {
      present++;
    }
  }

  const result: ValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      total: REQUIRED_CONFIG.length,
      present,
      missing,
      invalid,
    },
  };

  console.log('[ConfigValidator] Validation complete:');
  console.log(`  ✓ Present: ${present}/${REQUIRED_CONFIG.length}`);
  console.log(`  ✗ Missing: ${missing}`);
  console.log(`  ⚠ Invalid: ${invalid}`);
  console.log(`  Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}`);

  return result;
}

export async function printValidationReport(storage: IStorage): Promise<void> {
  const result = await validateConfiguration(storage);

  console.log('\n' + '='.repeat(60));
  console.log('📋 CONFIGURATION VALIDATION REPORT');
  console.log('='.repeat(60));
  
  if (result.valid) {
    console.log('\n✅ All required configuration is valid!\n');
  } else {
    console.log('\n❌ Configuration validation failed!\n');
  }

  console.log(`Summary:`);
  console.log(`  Total checks: ${result.summary.total}`);
  console.log(`  Present & valid: ${result.summary.present}`);
  console.log(`  Missing: ${result.summary.missing}`);
  console.log(`  Invalid: ${result.summary.invalid}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach(err => console.log(`  ${err}`));
  }

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach(warn => console.log(`  ${warn}`));
  }

  console.log('\n' + '='.repeat(60) + '\n');

  if (!result.valid) {
    throw new Error('Configuration validation failed - please fix errors above');
  }
}
