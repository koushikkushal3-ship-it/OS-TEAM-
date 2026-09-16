import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuditActor, type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import { notify, recycle } from '../platform/records.js';

const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'] as const;
const EXPENSE_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REIMBURSED'] as const;

const budgetSchema = z.object({
  name: z.string().trim().min(2).max(120),
  amount: z.number().nonnegative(),
  eventId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

const expenseSchema = z.object({
  title: z.string().trim().min(2).max(200),
  category: z.string().trim().min(2).max(60),
  amount: z.number().positive(),
  eventId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  budgetId: z.string().uuid().nullish(),
  paidById: z.string().uuid().nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('UPI'),
  spentAt: z.coerce.date(),
  description: z.string().trim().max(2000).nullish(),
});

const reviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']),
  note: z.string().trim().max(1000).nullish(),
});

const reimburseSchema = z.object({ reference: z.string().trim().max(120).nullish() });

const listSchema = z.object({
  eventId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  status: z.enum(EXPENSE_STATUSES).optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(200).default(100),
});

const summarySchema = z.object({ eventId: z.string().uuid().optional(), teamId: z.string().uuid().optional() });

const expenseSelect = {
  id: true,
  title: true,
  category: true,
  amount: true,
  paymentMethod: true,
  spentAt: true,
  description: true,
  status: true,
  reviewedAt: true,
  reviewNote: true,
  reimbursedAt: true,
  reimbursedRef: true,
  createdAt: true,
  eventId: true,
  teamId: true,
  event: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  budget: { select: { id: true, name: true } },
  paidBy: { select: { id: true, name: true } },
  submittedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
} as const;

/** Expenses in these states are still moving through the workflow. */
const OPEN_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'] as const;

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Separation of duties: by default the person who submits an expense cannot
   * approve it. A small organization can switch this off in
   * Master Admin → Modules → Finance.
   */
  private async needsTwoApprovers(organizationId: string, amount: number) {
    const rule = await this.prisma.automationRule.findFirst({
      where: { organizationId, trigger: 'EXPENSE_TWO_APPROVERS', enabled: true },
    });
    const minAmount = Number((rule?.config as { minAmount?: number } | undefined)?.minAmount ?? Infinity);
    return !!rule && amount >= minAmount;
  }

  private async allowSelfReview() {
    const financeModule = await this.prisma.module.findUnique({ where: { key: 'finance' } });
    const config = (financeModule?.config ?? {}) as { allowSelfReview?: boolean };
    return config.allowSelfReview === true;
  }

  // ── budgets ──────────────────────────────────────────────────

  listBudgets(auth: AuthContext, q: { eventId?: string; teamId?: string }) {
    return this.prisma.budget.findMany({
      where: { organizationId: auth.organizationId, eventId: q.eventId, teamId: q.teamId },
      orderBy: { createdAt: 'desc' },
      include: {
        event: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        _count: { select: { expenses: true } },
      },
    });
  }

  async saveBudget(auth: AuthContext, actor: AuditActor, input: z.infer<typeof budgetSchema>, id?: string) {
    await this.assertRefs(auth, input);
    const data = { ...input, organizationId: auth.organizationId, createdById: auth.userId };

    if (!id) {
      const budget = await this.prisma.budget.create({ data });
      await this.audit.record(actor, { action: 'budget.created', entityType: 'budget', entityId: budget.id, newValue: input });
      return budget;
    }
    const before = await this.prisma.budget.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    const budget = await this.prisma.budget.update({ where: { id }, data: input });
    await this.audit.record(actor, {
      action: 'budget.updated',
      entityType: 'budget',
      entityId: id,
      oldValue: { name: before.name, amount: before.amount },
      newValue: input,
    });
    return budget;
  }

  async removeBudget(auth: AuthContext, actor: AuditActor, id: string) {
    const before = await this.prisma.budget.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await recycle(this.prisma, { organizationId: auth.organizationId, entityType: 'budget', row: before, label: before.name, deletedById: auth.userId });
    await this.prisma.budget.delete({ where: { id } });
    await this.audit.record(actor, {
      action: 'budget.deleted',
      entityType: 'budget',
      entityId: id,
      oldValue: { name: before.name, amount: before.amount },
    });
  }

  // ── expenses ─────────────────────────────────────────────────

  async listExpenses(auth: AuthContext, q: z.infer<typeof listSchema>) {
    const rows = await this.prisma.expense.findMany({
      where: {
        organizationId: auth.organizationId,
        eventId: q.eventId,
        teamId: q.teamId,
        status: q.status,
        ...(q.mine && { OR: [{ submittedById: auth.userId }, { paidById: auth.userId }] }),
      },
      orderBy: { spentAt: 'desc' },
      take: q.limit,
      select: expenseSelect,
    });

    const visible = [];
    for (const row of rows) if (await this.canSee(auth, row)) visible.push(row);
    return visible;
  }

  async getExpense(auth: AuthContext, id: string) {
    const expense = await this.prisma.expense.findFirstOrThrow({
      where: { id, organizationId: auth.organizationId },
      select: expenseSelect,
    });
    if (!(await this.canSee(auth, expense))) throw new ForbiddenException('You cannot view this expense');

    const target = { teamId: expense.teamId ?? undefined, eventId: expense.eventId ?? undefined };
    const [canEdit, canApprove, canDelete, selfReview] = await Promise.all([
      this.permissions.can(auth, 'finance.edit', target),
      this.permissions.can(auth, 'finance.approve', target),
      this.permissions.can(auth, 'finance.delete', target),
      this.allowSelfReview(),
    ]);
    const ownSubmission = expense.submittedBy?.id === auth.userId;
    return {
      ...expense,
      capabilities: {
        canEdit,
        canApprove,
        canDelete,
        // Approving is only offered when it will actually succeed.
        canReview: canApprove && expense.status !== 'REIMBURSED' && (!ownSubmission || selfReview),
        blockedBySelfReview: canApprove && ownSubmission && !selfReview,
      },
    };
  }

  async createExpense(auth: AuthContext, actor: AuditActor, input: z.infer<typeof expenseSchema>) {
    await this.permissions.assert(auth, 'finance.create', {
      teamId: input.teamId ?? undefined,
      eventId: input.eventId ?? undefined,
    });
    await this.assertRefs(auth, input);

    const expense = await this.prisma.expense.create({
      data: {
        ...input,
        organizationId: auth.organizationId,
        submittedById: auth.userId,
        paidById: input.paidById ?? auth.userId,
        status: 'SUBMITTED',
      },
      select: expenseSelect,
    });
    await this.audit.record(actor, {
      action: 'expense.submitted',
      entityType: 'expense',
      entityId: expense.id,
      newValue: { title: expense.title, amount: input.amount, category: input.category, eventId: input.eventId },
    });
    return expense;
  }

  async updateExpense(auth: AuthContext, actor: AuditActor, id: string, input: Partial<z.infer<typeof expenseSchema>>) {
    const before = await this.prisma.expense.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    const target = { teamId: before.teamId ?? undefined, eventId: before.eventId ?? undefined };

    // The person who submitted it can fix their own entry until it is approved.
    const ownWhileOpen = before.submittedById === auth.userId && (OPEN_STATUSES as readonly string[]).includes(before.status);
    if (!ownWhileOpen) await this.permissions.assert(auth, 'finance.edit', target);
    if (before.status === 'REIMBURSED') throw new BadRequestException('A reimbursed expense can no longer be edited');
    await this.assertRefs(auth, input);

    const expense = await this.prisma.expense.update({ where: { id }, data: input, select: expenseSelect });
    await this.audit.record(actor, {
      action: 'expense.updated',
      entityType: 'expense',
      entityId: id,
      oldValue: Object.fromEntries(Object.keys(input).map((k) => [k, before[k as keyof typeof before]])),
      newValue: input,
    });
    return expense;
  }

  /** Approve, reject, or send it back for changes (arch doc §31). */
  async review(auth: AuthContext, actor: AuditActor, id: string, input: z.infer<typeof reviewSchema>) {
    const before = await this.prisma.expense.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.permissions.assert(auth, 'finance.approve', {
      teamId: before.teamId ?? undefined,
      eventId: before.eventId ?? undefined,
    });
    if (before.status === 'REIMBURSED') throw new BadRequestException('This expense is already reimbursed');
    if (before.submittedById === auth.userId && !(await this.allowSelfReview())) {
      throw new ForbiddenException('Someone else must review an expense you submitted');
    }

    // Automation rule: large expenses need two different approvers.
    const twoApprovers = input.decision === 'APPROVE' && (await this.needsTwoApprovers(auth.organizationId, Number(before.amount)));
    if (twoApprovers && before.firstApprovedById === auth.userId) {
      throw new ForbiddenException('You already gave the first approval. A different person must give the second.');
    }
    const firstOfTwo = twoApprovers && !before.firstApprovedById;

    const status = firstOfTwo
      ? 'UNDER_REVIEW'
      : input.decision === 'APPROVE' ? 'APPROVED' : input.decision === 'REJECT' ? 'REJECTED' : 'UNDER_REVIEW';
    const expense = await this.prisma.expense.update({
      where: { id },
      data: firstOfTwo
        ? { status, firstApprovedById: auth.userId, reviewNote: input.note }
        : { status, reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: input.note },
      select: expenseSelect,
    });
    await notify(this.prisma, {
      organizationId: auth.organizationId,
      userIds: [before.submittedById],
      exceptUserId: auth.userId,
      type: 'expense.reviewed',
      title: firstOfTwo
        ? `First approval for "${before.title}" — waiting for a second approver`
        : `Expense ${status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'rejected' : 'sent back'}: ${before.title}`,
      body: input.note,
      link: '/finance',
    });
    await this.audit.record(actor, {
      action: `expense.${status.toLowerCase()}`,
      entityType: 'expense',
      entityId: id,
      oldValue: { status: before.status },
      newValue: { status, note: input.note, amount: before.amount },
    });
    return expense;
  }

  async reimburse(auth: AuthContext, actor: AuditActor, id: string, input: z.infer<typeof reimburseSchema>) {
    const before = await this.prisma.expense.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.permissions.assert(auth, 'finance.approve', {
      teamId: before.teamId ?? undefined,
      eventId: before.eventId ?? undefined,
    });
    if (before.status !== 'APPROVED') throw new BadRequestException('Only an approved expense can be reimbursed');

    const expense = await this.prisma.expense.update({
      where: { id },
      data: { status: 'REIMBURSED', reimbursedAt: new Date(), reimbursedRef: input.reference },
      select: expenseSelect,
    });
    await this.audit.record(actor, {
      action: 'expense.reimbursed',
      entityType: 'expense',
      entityId: id,
      oldValue: { status: before.status },
      newValue: { status: 'REIMBURSED', reference: input.reference, amount: before.amount },
    });
    return expense;
  }

  async removeExpense(auth: AuthContext, actor: AuditActor, id: string) {
    const before = await this.prisma.expense.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.permissions.assert(auth, 'finance.delete', {
      teamId: before.teamId ?? undefined,
      eventId: before.eventId ?? undefined,
    });
    await recycle(this.prisma, { organizationId: auth.organizationId, entityType: 'expense', row: before, label: before.title, deletedById: auth.userId });
    await this.prisma.expense.delete({ where: { id } });
    await this.audit.record(actor, {
      action: 'expense.deleted',
      entityType: 'expense',
      entityId: id,
      oldValue: { title: before.title, amount: before.amount, status: before.status },
    });
  }

  /** Budget, spend and what is still pending (Master Plan §10). */
  async summary(auth: AuthContext, q: z.infer<typeof summarySchema>) {
    const where = { organizationId: auth.organizationId, eventId: q.eventId, teamId: q.teamId };
    const [budgets, byStatus, pendingReimbursement] = await Promise.all([
      this.prisma.budget.aggregate({ where, _sum: { amount: true } }),
      this.prisma.expense.groupBy({ by: ['status'], where, _sum: { amount: true }, _count: true }),
      this.prisma.expense.aggregate({ where: { ...where, status: 'APPROVED' }, _sum: { amount: true }, _count: true }),
    ]);

    const amountFor = (statuses: readonly string[]) =>
      byStatus.filter((s) => statuses.includes(s.status)).reduce((total, s) => total + Number(s._sum.amount ?? 0), 0);

    const allocated = Number(budgets._sum.amount ?? 0);
    // Money the organization has committed: everything except rejected entries.
    const spent = amountFor(['APPROVED', 'REIMBURSED']);
    const pending = amountFor(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW']);

    return {
      allocated,
      spent,
      pending,
      remaining: allocated - spent,
      pendingVerification: byStatus.filter((s) => (OPEN_STATUSES as readonly string[]).includes(s.status)).reduce((n, s) => n + s._count, 0),
      pendingReimbursement: { count: pendingReimbursement._count, amount: Number(pendingReimbursement._sum.amount ?? 0) },
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, { count: s._count, amount: Number(s._sum.amount ?? 0) }])),
    };
  }

  // ── helpers ──────────────────────────────────────────────────

  /** Own submissions are always visible; everything else needs finance.view in scope. */
  private async canSee(auth: AuthContext, expense: { teamId: string | null; eventId: string | null; submittedBy?: { id: string } | null; paidBy?: { id: string } | null }) {
    if (expense.submittedBy?.id === auth.userId || expense.paidBy?.id === auth.userId) return true;
    return this.permissions.can(auth, 'finance.view', {
      teamId: expense.teamId ?? undefined,
      eventId: expense.eventId ?? undefined,
    });
  }

  private async assertRefs(auth: AuthContext, input: { eventId?: string | null; teamId?: string | null; budgetId?: string | null; paidById?: string | null }) {
    const organizationId = auth.organizationId;
    if (input.eventId && !(await this.prisma.event.count({ where: { id: input.eventId, organizationId } }))) {
      throw new BadRequestException('Event not found');
    }
    if (input.teamId && !(await this.prisma.team.count({ where: { id: input.teamId, organizationId } }))) {
      throw new BadRequestException('Team not found');
    }
    if (input.budgetId && !(await this.prisma.budget.count({ where: { id: input.budgetId, organizationId } }))) {
      throw new BadRequestException('Budget not found');
    }
    if (input.paidById && !(await this.prisma.user.count({ where: { id: input.paidById, organizationId } }))) {
      throw new BadRequestException('Person not found');
    }
  }
}

@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('summary')
  @RequirePermission('finance.view')
  summary(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(summarySchema)) q: z.infer<typeof summarySchema>) {
    return this.finance.summary(req.auth, q);
  }

  @Get('budgets')
  @RequirePermission('finance.view')
  listBudgets(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(summarySchema)) q: z.infer<typeof summarySchema>) {
    return this.finance.listBudgets(req.auth, q);
  }

  @Post('budgets')
  @RequirePermission('finance.edit')
  createBudget(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(budgetSchema)) body: z.infer<typeof budgetSchema>) {
    return this.finance.saveBudget(req.auth, actorFrom(req), body);
  }

  @Patch('budgets/:id')
  @RequirePermission('finance.edit')
  updateBudget(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(budgetSchema)) body: z.infer<typeof budgetSchema>,
  ) {
    return this.finance.saveBudget(req.auth, actorFrom(req), body, id);
  }

  @Delete('budgets/:id')
  @HttpCode(204)
  @RequirePermission('finance.delete')
  removeBudget(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.finance.removeBudget(req.auth, actorFrom(req), id);
  }

  @Get('expenses')
  listExpenses(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.finance.listExpenses(req.auth, q);
  }

  @Get('expenses/:id')
  getExpense(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.finance.getExpense(req.auth, id);
  }

  @Post('expenses')
  createExpense(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(expenseSchema)) body: z.infer<typeof expenseSchema>) {
    return this.finance.createExpense(req.auth, actorFrom(req), body);
  }

  @Patch('expenses/:id')
  updateExpense(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(expenseSchema.partial())) body: Partial<z.infer<typeof expenseSchema>>,
  ) {
    return this.finance.updateExpense(req.auth, actorFrom(req), id, body);
  }

  @Post('expenses/:id/review')
  review(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewSchema)) body: z.infer<typeof reviewSchema>,
  ) {
    return this.finance.review(req.auth, actorFrom(req), id, body);
  }

  @Post('expenses/:id/reimburse')
  reimburse(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reimburseSchema)) body: z.infer<typeof reimburseSchema>,
  ) {
    return this.finance.reimburse(req.auth, actorFrom(req), id, body);
  }

  @Delete('expenses/:id')
  @HttpCode(204)
  removeExpense(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.finance.removeExpense(req.auth, actorFrom(req), id);
  }
}

@Module({ controllers: [FinanceController], providers: [FinanceService], exports: [FinanceService] })
export class FinanceModule {}
