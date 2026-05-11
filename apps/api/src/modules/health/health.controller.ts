import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const start_at = Date.now();

@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  async check() {
    let db: 'up' | 'down' = 'down';
    try {
      await this.ds.query('SELECT 1');
      db = 'up';
    } catch {
      // db stays down
    }
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      uptime_s: Math.floor((Date.now() - start_at) / 1000),
      version: '0.1.0',
    };
  }
}
