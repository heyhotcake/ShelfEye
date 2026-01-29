import { Request, Response, NextFunction } from 'express';

const API_KEY = process.env.SHELFEYE_API_KEY;

export function isAuthEnabled(): boolean {
  return !!API_KEY && API_KEY.length > 0;
}

export function apiAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }

  const [scheme, token] = authHeader.split(' ');
  
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Invalid authorization format. Use: Bearer <API_KEY>' });
    return;
  }

  if (token !== API_KEY) {
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  next();
}

export function publicRoute(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
