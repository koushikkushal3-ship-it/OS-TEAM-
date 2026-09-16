import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import {
  type CreateTaskInput,
  type ListTasksInput,
  type ReviewInput,
  type UpdateTaskInput,
  type WorkUpdateInput,
  createTaskSchema,
  listTasksSchema,
  reviewSchema,
  statsSchema,
  updateTaskSchema,
  workUpdateSchema,
} from './dto.js';
import { TasksService } from './tasks.service.js';

/** Phase 2 — tasks, assignment and daily work updates. */
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(listTasksSchema)) q: ListTasksInput) {
    return this.tasks.list(req.auth, q);
  }

  /** Progress rollup — whole organization, one team or one event. */
  @Get('stats')
  stats(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(statsSchema)) q: { teamId?: string; eventId?: string }) {
    return this.tasks.stats(req.auth, q);
  }

  @Get('stats/mine')
  myStats(@Req() req: AuthenticatedRequest) {
    return this.tasks.stats(req.auth, { assignedToId: req.auth.userId });
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(req.auth, id);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(createTaskSchema)) body: CreateTaskInput) {
    return this.tasks.create(req.auth, actorFrom(req), body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateTaskSchema)) body: UpdateTaskInput,
  ) {
    return this.tasks.update(req.auth, actorFrom(req), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.remove(req.auth, actorFrom(req), id);
  }

  @Post(':id/updates')
  addUpdate(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(workUpdateSchema)) body: WorkUpdateInput,
  ) {
    return this.tasks.addUpdate(req.auth, actorFrom(req), id, body);
  }

  @Post(':id/updates/:updateId/review')
  review(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('updateId', ParseUUIDPipe) updateId: string,
    @Body(new ZodPipe(reviewSchema)) body: ReviewInput,
  ) {
    return this.tasks.review(req.auth, actorFrom(req), id, updateId, body);
  }
}

@Module({ controllers: [TasksController], providers: [TasksService], exports: [TasksService] })
export class TasksModule {}
