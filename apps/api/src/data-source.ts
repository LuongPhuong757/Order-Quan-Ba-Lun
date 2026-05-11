import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from './modules/auth/entities/user.entity.js';
import { AuditLog } from './modules/audit/entities/audit-log.entity.js';
import { RevokedJti } from './modules/auth/entities/revoked-jti.entity.js';
import { RecoveryCode } from './modules/auth/entities/recovery-code.entity.js';

export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  username: process.env.MYSQL_USER || 'order_app',
  password: process.env.MYSQL_PASSWORD || 'order_app_pass',
  database: process.env.MYSQL_DATABASE || 'order_quan_balun',
  charset: 'utf8mb4',
  entities: [User, AuditLog, RevokedJti, RecoveryCode],
  migrations: ['src/migrations/*.ts'],
  // Use synchronize:true ONLY for first-run dev — production migrations only.
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV !== 'production' ? ['error', 'warn'] : false,
};

export const AppDataSource = new DataSource(dataSourceOptions);
