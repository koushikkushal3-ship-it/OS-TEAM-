import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import {
  type ActionItemInput,
  type AttendanceOverrideInput,
  type AttendanceStatsInput,
  type CreateMeetingInput,
  type DecisionInput,
  type ListMeetingsInput,
  type ParticipantInput,
  type SessionInputDto,
  type UpdateMeetingInput,
  actionItemSchema,
  attendanceOverrideSchema,
  attendanceStatsSchema,
  createMeetingSchema,
  decisionSchema,
  listMeetingsSchema,
  participantSchema,
  sessionSchema,
  updateMeetingSchema,
} from './dto.js';
import { MeetingsService } from './meetings.service.js';

/** Phase 3 — Meeting Center. */
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(listMeetingsSchema)) q: ListMeetingsInput) {
    return this.meetings.list(req.auth, q);
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.get(req.auth, id);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(createMeetingSchema)) body: CreateMeetingInput) {
    return this.meetings.create(req.auth, actorFrom(req), body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateMeetingSchema)) body: UpdateMeetingInput,
  ) {
    return this.meetings.update(req.auth, actorFrom(req), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.remove(req.auth, actorFrom(req), id);
  }

  @Post(':id/start')
  start(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.start(req.auth, actorFrom(req), id);
  }

  @Post(':id/end')
  end(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.end(req.auth, actorFrom(req), id);
  }

  /** Records the join and hands back the link to open. */
  @Post(':id/join')
  join(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.join(req.auth, actorFrom(req), id);
  }

  @Post(':id/leave')
  leave(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetings.leave(req.auth, actorFrom(req), id);
  }

  @Post(':id/participants')
  setParticipant(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(participantSchema)) body: ParticipantInput,
  ) {
    return this.meetings.setParticipant(req.auth, actorFrom(req), id, body);
  }

  @Delete(':id/participants/:userId')
  @HttpCode(204)
  removeParticipant(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.meetings.removeParticipant(req.auth, actorFrom(req), id, userId);
  }

  @Post(':id/sessions')
  addSession(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(sessionSchema)) body: SessionInputDto,
  ) {
    return this.meetings.addSession(req.auth, actorFrom(req), id, body);
  }

  @Patch(':id/attendance/:userId')
  overrideAttendance(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(attendanceOverrideSchema)) body: AttendanceOverrideInput,
  ) {
    return this.meetings.overrideAttendance(req.auth, actorFrom(req), id, userId, body);
  }

  @Post(':id/decisions')
  addDecision(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(decisionSchema)) body: DecisionInput,
  ) {
    return this.meetings.addDecision(req.auth, actorFrom(req), id, body);
  }

  @Delete(':id/decisions/:decisionId')
  @HttpCode(204)
  removeDecision(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
  ) {
    return this.meetings.removeDecision(req.auth, actorFrom(req), id, decisionId);
  }

  @Post(':id/actions')
  addActionItem(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(actionItemSchema)) body: ActionItemInput,
  ) {
    return this.meetings.addActionItem(req.auth, actorFrom(req), id, body);
  }

  @Delete(':id/actions/:actionId')
  @HttpCode(204)
  removeActionItem(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ) {
    return this.meetings.removeActionItem(req.auth, actorFrom(req), id, actionId);
  }
}

/** Attendance views (arch doc §9, §27). Thresholds live on the attendance module config. */
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get('policy')
  policy() {
    return this.meetings.policy();
  }

  @Get('stats')
  stats(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(attendanceStatsSchema)) q: AttendanceStatsInput) {
    return this.meetings.attendanceStats(req.auth, q);
  }
}

@Module({ controllers: [MeetingsController, AttendanceController], providers: [MeetingsService], exports: [MeetingsService] })
export class MeetingsModule {}
