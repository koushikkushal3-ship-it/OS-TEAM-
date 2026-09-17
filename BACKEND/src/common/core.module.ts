import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditService } from '../modules/audit/audit.service.js';
import { SessionService } from '../modules/auth/session.service.js';
import { PermissionService } from '../modules/permissions/permission.service.js';
import { PlatformSettingsService } from '../modules/platform/platform-settings.service.js';
import { HttpExceptionFilter } from './filters/http-exception.filter.js';
import { AccessGuard } from './guards/access.guard.js';
import { FileStorageService } from '../modules/platform/file-storage.service.js';

/** Cross-cutting services available to every module. */
@Global()
@Module({
  providers: [
    PermissionService,
    AuditService,
    SessionService,
    PlatformSettingsService,
    FileStorageService,
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
  exports: [PermissionService, AuditService, SessionService, PlatformSettingsService, FileStorageService],
})
export class CoreModule {}
