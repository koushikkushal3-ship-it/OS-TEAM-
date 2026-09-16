import { Module } from '@nestjs/common';
import { PermissionsController } from './permissions.controller.js';

// PermissionService itself is provided globally by CoreModule.
@Module({ controllers: [PermissionsController] })
export class PermissionsModule {}
