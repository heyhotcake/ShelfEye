import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import path from "path";

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
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
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
