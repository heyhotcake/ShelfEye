import { drizzle } from 'drizzle-orm/neon-serverless';
import { neonConfig, Pool } from '@neondatabase/serverless';
import * as schema from '@shared/schema';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

class DatabaseConnectionManager {
  private pool: Pool;
  private db: ReturnType<typeof drizzle>;
  private connectionString: string;
  private isHealthy: boolean = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds
  private readonly RECONNECT_DELAY_MS = 5000; // 5 seconds

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    this.pool = this.createPool();
    this.db = drizzle(this.pool, { schema });
    this.setupEventHandlers();
    this.startHealthCheck();
  }

  private createPool(): Pool {
    const pool = new Pool({
      connectionString: this.connectionString,
      max: 20, // Maximum connections in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    console.log('[Database] Connection pool created');
    return pool;
  }

  private setupEventHandlers(): void {
    this.pool.on('error', (err) => {
      console.error('[Database] ❌ Pool error:', err);
      this.isHealthy = false;
      this.handleConnectionLoss();
    });

    this.pool.on('connect', () => {
      console.log('[Database] ✅ Client connected to pool');
      this.isHealthy = true;
      this.reconnectAttempts = 0;
    });

    this.pool.on('remove', () => {
      console.log('[Database] Client removed from pool');
    });
  }

  private async handleConnectionLoss(): Promise<void> {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('[Database] Max reconnection attempts reached. Giving up.');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[Database] Attempting reconnection ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}...`);

    await new Promise(resolve => setTimeout(resolve, this.RECONNECT_DELAY_MS));

    try {
      await this.pool.end();
      console.log('[Database] Closed old pool, creating new connection...');
      
      this.pool = this.createPool();
      this.db = drizzle(this.pool, { schema });
      this.setupEventHandlers();
      
      await this.pool.query('SELECT 1');
      console.log('[Database] ✅ Reconnection successful - new pool created');
      this.isHealthy = true;
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error('[Database] Reconnection failed:', error);
      await this.handleConnectionLoss();
    }
  }

  private async checkHealth(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      if (!this.isHealthy) {
        console.log('[Database] ✅ Health check passed - connection restored');
      }
      this.isHealthy = true;
      this.reconnectAttempts = 0;
      return true;
    } catch (error) {
      if (this.isHealthy) {
        console.error('[Database] ❌ Health check failed:', error);
      }
      this.isHealthy = false;
      return false;
    }
  }

  private startHealthCheck(): void {
    this.checkHealth();

    this.healthCheckInterval = setInterval(async () => {
      const healthy = await this.checkHealth();
      if (!healthy) {
        this.handleConnectionLoss();
      }
    }, this.HEALTH_CHECK_INTERVAL_MS);

    console.log(`[Database] Health check started (interval: ${this.HEALTH_CHECK_INTERVAL_MS}ms)`);
  }

  public stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[Database] Health check stopped');
    }
  }

  public getDb() {
    return this.db;
  }

  public getPool() {
    return this.pool;
  }

  public isConnectionHealthy(): boolean {
    return this.isHealthy;
  }

  public async close(): Promise<void> {
    this.stopHealthCheck();
    await this.pool.end();
    console.log('[Database] Connection pool closed');
  }
}

const dbManager = new DatabaseConnectionManager(process.env.DATABASE_URL);

export const db = dbManager.getDb();
export const pool = dbManager.getPool();
export const getDatabaseHealth = () => dbManager.isConnectionHealthy();
