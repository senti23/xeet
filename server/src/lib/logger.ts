import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.isDev ? 'debug' : 'info',
  transport: config.isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});

export function childLogger(name: string) {
  return logger.child({ module: name });
}
