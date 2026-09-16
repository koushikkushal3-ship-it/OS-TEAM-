import { Controller, Get, Module } from '@nestjs/common';
import { CoreModule } from './common/core.module.js';
import { Public } from './common/decorators/auth.decorators.js';
import { PrismaModule, PrismaService } from './prisma/prisma.service.js';
// Phase 1 — Foundation
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CustomModulesModule } from './modules/custom/custom.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { DepartmentsModule } from './modules/departments/departments.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { MasterAdminModule } from './modules/master-admin/master-admin.module.js';
import { ModulesRegistryModule } from './modules/modules-registry/modules-registry.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { PermissionsModule } from './modules/permissions/permissions.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { TeamsModule } from './modules/teams/teams.module.js';
import { UsersModule } from './modules/users/users.module.js';
// Phases 2–5 — planned
import { DocumentsModule } from './modules/documents/documents.module.js';
import { FinanceModule } from './modules/finance/finance.module.js';
import { IdeasModule } from './modules/ideas/ideas.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { MeetingsModule } from './modules/meetings/meetings.module.js';
import { OpportunitiesModule } from './modules/opportunities/opportunities.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { TicketsModule } from './modules/tickets/tickets.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';
import { EventOpsModule } from './modules/event-ops/event-ops.module.js';
import { AutomationModule } from './modules/automation/automation.module.js';
import { ControlModule } from './modules/control/control.module.js';
import { ScheduleModule } from './modules/schedule/schedule.module.js';

@Controller()
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Also touches the database, so an uptime monitor calling this keeps both the free
   * Render service and the free Supabase project from going to sleep.
   */
  @Public()
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', service: 'team-os-backend' };
  }
}

@Module({
  imports: [
    PrismaModule,
    CoreModule,
    AuthModule,
    OrganizationModule,
    DepartmentsModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    TeamsModule,
    EventsModule,
    ModulesRegistryModule,
    AuditModule,
    MasterAdminModule,
    CustomModulesModule,
    DashboardModule,
    TasksModule,
    MeetingsModule,
    FinanceModule,
    DocumentsModule,
    IdeasModule,
    OpportunitiesModule,
    TicketsModule,
    ReportsModule,
    WorkspaceModule,
    EventOpsModule,
    AutomationModule,
    ControlModule,
    ScheduleModule,
    IntegrationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
