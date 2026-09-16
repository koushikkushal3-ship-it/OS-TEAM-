import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuditActor, type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { GoogleDriveService } from '../integrations/google-drive.service.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import { recycle } from '../platform/records.js';

const MAX_BYTES = 25 * 1024 * 1024;

/** Records a file can hang off, and the Drive folder each one uses. */
const ENTITIES = {
  expense: 'Finance',
  idea: 'Ideas',
  ticket: 'Tickets',
  opportunity: 'Opportunities',
  meeting: 'Meetings',
  task: 'Tasks',
  event: 'Events',
} as const;

type EntityType = keyof typeof ENTITIES;

const uploadSchema = z.object({
  entityType: z.enum(Object.keys(ENTITIES) as [EntityType, ...EntityType[]]),
  entityId: z.string().uuid(),
  kind: z.enum(['ATTACHMENT', 'INVOICE', 'PAYMENT_PROOF', 'PROPOSAL', 'DOCUMENT', 'SCREENSHOT']).default('ATTACHMENT'),
});

const listSchema = z.object({
  entityType: z.enum(Object.keys(ENTITIES) as [EntityType, ...EntityType[]]),
  entityId: z.string().uuid(),
});

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly drive: GoogleDriveService,
    private readonly audit: AuditService,
  ) {}

  /** The parent record must exist in this organization before a file can attach to it. */
  private async assertEntity(auth: AuthContext, entityType: EntityType, entityId: string) {
    const where = { id: entityId, organizationId: auth.organizationId };
    const found =
      entityType === 'expense'
        ? await this.prisma.expense.count({ where })
        : entityType === 'idea'
          ? await this.prisma.idea.count({ where })
          : entityType === 'ticket'
            ? await this.prisma.ticket.count({ where })
            : entityType === 'opportunity'
              ? await this.prisma.opportunity.count({ where })
              : entityType === 'meeting'
                ? await this.prisma.meeting.count({ where })
                : entityType === 'task'
                  ? await this.prisma.task.count({ where })
                  : await this.prisma.event.count({ where });
    if (!found) throw new BadRequestException('The record this file belongs to was not found');
  }

  async list(auth: AuthContext, entityType: EntityType, entityId: string) {
    await this.permissions.assert(auth, 'document.view');
    await this.assertEntity(auth, entityType, entityId);
    return this.prisma.fileRecord.findMany({
      where: { organizationId: auth.organizationId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        mimeType: true,
        size: true,
        kind: true,
        createdAt: true,
        uploadedBy: { select: { id: true, name: true } },
      },
    });
  }

  async upload(
    auth: AuthContext,
    actor: AuditActor,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    input: z.infer<typeof uploadSchema>,
  ) {
    await this.permissions.assert(auth, 'document.upload');
    await this.assertEntity(auth, input.entityType, input.entityId);
    if (file.size > MAX_BYTES) throw new BadRequestException('Files must be 25 MB or smaller');

    const uploaded = await this.drive.upload(file, ENTITIES[input.entityType]);
    const record = await this.prisma.fileRecord.create({
      data: {
        organizationId: auth.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        driveFileId: uploaded.id,
        name: uploaded.name,
        mimeType: uploaded.mimeType || file.mimetype,
        size: uploaded.size || file.size,
        kind: input.kind,
        uploadedById: auth.userId,
      },
      select: { id: true, name: true, mimeType: true, size: true, kind: true, createdAt: true },
    });
    await this.audit.record(actor, {
      action: 'document.uploaded',
      entityType: input.entityType,
      entityId: input.entityId,
      newValue: { fileId: record.id, name: record.name, kind: record.kind, size: record.size },
    });
    return record;
  }

  /** Streams the bytes back through TEAM OS — Drive files are never made public. */
  async download(auth: AuthContext, id: string) {
    await this.permissions.assert(auth, 'document.view');
    const record = await this.prisma.fileRecord.findFirstOrThrow({
      where: { id, organizationId: auth.organizationId },
    });
    await this.assertEntity(auth, record.entityType as EntityType, record.entityId);
    return { record, buffer: await this.drive.download(record.driveFileId) };
  }

  async remove(auth: AuthContext, actor: AuditActor, id: string) {
    const record = await this.prisma.fileRecord.findFirstOrThrow({
      where: { id, organizationId: auth.organizationId },
    });
    const isUploader = record.uploadedById === auth.userId;
    if (!isUploader && !(await this.permissions.can(auth, 'document.delete'))) {
      throw new ForbiddenException('You cannot delete this file');
    }

    // The Drive copy is kept until Master Admin deletes it permanently or the bin purges it.
    await recycle(this.prisma, { organizationId: auth.organizationId, entityType: 'file', row: record, label: record.name, deletedById: auth.userId });
    await this.prisma.fileRecord.delete({ where: { id } });
    await this.audit.record(actor, {
      action: 'document.deleted',
      entityType: record.entityType,
      entityId: record.entityId,
      oldValue: { fileId: id, name: record.name },
    });
  }
}

@Controller('files')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.documents.list(req.auth, q.entityType, q.entityId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  upload(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    @Body() body: unknown,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');
    const input = uploadSchema.parse(body);
    return this.documents.upload(req.auth, actorFrom(req), file, input);
  }

  @Get(':id/download')
  async download(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { record, buffer } = await this.documents.download(req.auth, id);
    // Recorded so the Master console can spot someone pulling many files at once.
    await this.audit.record(actorFrom(req), { action: 'file.downloaded', entityType: 'file', entityId: id, newValue: { name: record.name } });
    res.setHeader('Content-Type', record.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(record.name)}"`);
    res.send(buffer);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.remove(req.auth, actorFrom(req), id);
  }
}

@Module({
  imports: [IntegrationsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
