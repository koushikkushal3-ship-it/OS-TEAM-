import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

/** Uniform error shape: `{ statusCode, message, code?, issues? }`. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      res.status(status).json({ statusCode: status, ...payload });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        res.status(HttpStatus.CONFLICT).json({ statusCode: 409, message: 'A record with these values already exists' });
        return;
      }
      if (exception.code === 'P2025') {
        res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Record not found' });
        return;
      }
    }

    this.logger.error(exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Internal server error' });
  }
}
