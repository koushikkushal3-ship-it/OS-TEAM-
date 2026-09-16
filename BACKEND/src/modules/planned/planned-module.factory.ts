import { Controller, Get, Module, type Type } from '@nestjs/common';

export interface PlannedModuleInfo {
  /** Route prefix, e.g. "tasks" */
  path: string;
  name: string;
  phase: number;
  scope: string[];
}

/**
 * Placeholder for a module scheduled in a later roadmap phase. Exposes
 * `GET /<path>/status` so the frontend can show what is coming. Replace the
 * module file with a real implementation when its phase starts.
 */
export function createPlannedModule(info: PlannedModuleInfo): Type<unknown> {
  @Controller(info.path)
  class PlannedController {
    @Get('status')
    status() {
      return { module: info.path, name: info.name, phase: info.phase, status: 'planned', scope: info.scope };
    }
  }

  @Module({ controllers: [PlannedController] })
  class PlannedModule {}

  Object.defineProperty(PlannedModule, 'name', { value: `${info.name.replace(/\W/g, '')}PlannedModule` });
  return PlannedModule;
}
