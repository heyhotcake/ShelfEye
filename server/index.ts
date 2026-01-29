import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import path from "path";
import { apiAuthMiddleware, isAuthEnabled } from "./utils/api-auth";
import { validateAndExit } from "./utils/env-validation";

// Validate environment variables before anything else
validateAndExit();

// Fatal error handlers - ensure clean restart under systemd on unrecoverable errors
// These catch errors that escape all other handlers and would leave the process in a broken state
process.on('uncaughtException', (err: Error) => {
  console.error('[FATAL] Uncaught exception - process will exit for clean restart:', err);
  // Give time for logs to flush before exiting
  setImmediate(() => process.exit(1));
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('[FATAL] Unhandled promise rejection - process will exit for clean restart:', reason);
  // Give time for logs to flush before exiting
  setImmediate(() => process.exit(1));
});

// Custom fatal error event for services to emit when they detect unrecoverable state
process.on('fatal-error', (context: string, err?: Error) => {
  console.error(`[FATAL] ${context} - process will exit for clean restart:`, err || 'No error details');
  setImmediate(() => process.exit(1));
});

const app = express();

// Security headers (helmet)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Vite dev requires unsafe-inline/eval
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'], // WebSocket for Vite HMR
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null, // Disable in development
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for camera preview compatibility
}));

// CORS configuration - strict in production, relaxed for development
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, same-origin)
    if (!origin) return callback(null, true);
    
    // Always allow explicitly configured origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // In development mode, allow common development domains
    if (isDevelopment) {
      if (origin.includes('localhost') || 
          origin.includes('127.0.0.1') ||
          origin.includes('.replit.dev') || 
          origin.includes('.repl.co')) {
        return callback(null, true);
      }
    }
    
    // Production: only allow explicitly configured origins
    console.warn(`[CORS] Blocked request from origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Request timeout middleware (30 seconds default, extended for specific routes)
const DEFAULT_TIMEOUT_MS = 30000;
app.use((req, res, next) => {
  // Skip timeout for long-running operations (calibration, capture)
  const longRunningPaths = ['/api/calibrate', '/api/capture', '/api/preview'];
  const isLongRunning = longRunningPaths.some(p => req.path.startsWith(p));
  
  if (!isLongRunning) {
    const timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        console.warn(`[Timeout] Request timed out: ${req.method} ${req.path}`);
        res.status(503).json({ error: 'Request timeout', message: 'The server took too long to respond' });
      }
    }, DEFAULT_TIMEOUT_MS);
    
    res.on('finish', () => clearTimeout(timeoutId));
    res.on('close', () => clearTimeout(timeoutId));
  }
  
  next();
});

console.log('[Security] Helmet security headers ENABLED');
console.log('[Security] CORS configured for origins:', allowedOrigins.join(', '));
console.log('[Security] Request timeout: 30s (extended for calibration/capture routes)');

// Serve static files from data directory for debug/download
app.use('/data', express.static(path.join(process.cwd(), 'data')));

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// API authentication middleware - protects all /api routes except health checks
// Set SHELFEYE_API_KEY environment variable to enable
app.use('/api', (req, res, next) => {
  // Allow health check without auth
  if (req.path === '/health' || req.path === '/ping') {
    return next();
  }
  return apiAuthMiddleware(req, res, next);
});

// Log auth status on startup
if (isAuthEnabled()) {
  console.log('[Security] API authentication ENABLED - all /api routes require Bearer token');
} else {
  console.log('[Security] WARNING: API authentication DISABLED - set SHELFEYE_API_KEY to secure API');
}

// Sanitize sensitive data from log output
function sanitizeForLogging(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'api_key', 'authorization', 'credentials'];
  const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };
  
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeForLogging(sanitized[key]);
    }
  }
  return sanitized;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const sanitized = sanitizeForLogging(capturedJsonResponse);
        logLine += ` :: ${JSON.stringify(sanitized)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    console.error('[Error Handler]', err);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
  });
})();
