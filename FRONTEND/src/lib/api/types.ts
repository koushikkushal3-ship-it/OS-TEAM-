// Response shapes of the TEAM OS backend (BACKEND/src/modules/*).

export type UserStatus = "INVITED" | "ACTIVE" | "DISABLED";
export type TeamMemberRole = "LEAD" | "CO_LEAD" | "MEMBER";
export type EventStatus = "PLANNING" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
export type RoleScope = "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "EVENT";
export type OverrideScope = "GLOBAL" | "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "EVENT" | "ROLE" | "USER";
export type ModuleStatus = "ENABLED" | "DISABLED" | "PLANNED";

export interface Ref {
  id: string;
  name: string;
}

export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    organization: Ref;
    department: Ref | null;
  };
  roles: { id: string; key: string; name: string; scopeType: RoleScope; scopeId: string | null }[];
  teams: (Ref & { memberRole: TeamMemberRole })[];
  permissions: string[];
  modules: string[];
  plannedModules: { key: string; name: string; phase: number }[];
  master?: { privileged: boolean; privilegedUntil: string | null };
  maintenance: { enabled: boolean; message: string; scope: "everyone" | "personal" } | null;
  /** Present while a Master Admin is previewing the portal as this person. */
  viewAs: { impersonatorName: string; expiresAt: string } | null;
}

export interface DashboardSummary {
  kind: "member" | "lead" | "admin";
  myTeams: (Ref & { memberRole: TeamMemberRole; _count: { members: number; events: number } })[];
  leadTeams: (Ref & { memberRole: TeamMemberRole; _count: { members: number; events: number } })[];
  activeEvents: (Ref & {
    status: EventStatus;
    startDate: string | null;
    endDate: string | null;
    venue: string | null;
    _count: { teams: number };
  })[];
  organization: { activeUsers: number; invitedUsers: number; teams: number; events: number; work: TaskStats } | null;
  myWork: TaskStats;
  dueSoon: (Ref & {
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    percentage: number;
    dueDate: string | null;
    team: Ref | null;
    event: Ref | null;
  })[];
  teamProgress: TeamProgress[];
  nextMeetings: (Ref & {
    title: string;
    type: MeetingType;
    status: MeetingStatus;
    scheduledStart: string;
    scheduledEnd: string;
    joinUrl: string | null;
    location: string | null;
    team: Ref | null;
    event: Ref | null;
  })[];
  myAttendance: AttendanceStats;
}

export interface MemberRow {
  memberRole: TeamMemberRole;
  joinedAt: string;
  user: { id: string; name: string; email: string; avatarUrl: string | null; status: UserStatus };
}

export interface TeamListItem extends Ref {
  description: string | null;
  isActive: boolean;
  isMember: boolean;
  department: Ref | null;
  members: MemberRow[];
  _count: { members: number; events: number };
}

export interface TeamDetail extends Ref {
  description: string | null;
  isActive: boolean;
  department: Ref | null;
  members: MemberRow[];
  events: { event: Ref & { status: EventStatus; startDate: string | null; endDate: string | null } }[];
  capabilities: { canUpdate: boolean; canManageMembers: boolean; canRemove: boolean };
}

export interface EventListItem extends Ref {
  description: string | null;
  venue: string | null;
  startDate: string | null;
  endDate: string | null;
  budget: string | null;
  status: EventStatus;
  owner: Ref | null;
  teams: { team: Ref }[];
  _count: { members: number };
}

export interface EventDetail extends Omit<EventListItem, "teams" | "_count"> {
  owner: (Ref & { email: string }) | null;
  teams: {
    team: Ref & {
      members: { memberRole: TeamMemberRole; user: Ref }[];
      _count: { members: number };
    };
  }[];
  members: { role: string | null; user: Ref & { email: string; avatarUrl: string | null } }[];
  capabilities: { canUpdate: boolean; canManageTeams: boolean; canDelete: boolean };
}

export interface Person {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  department: Ref | null;
  roles: { id: string; scopeType: RoleScope; scopeId: string | null; role: Ref & { isMasterAdmin: boolean } }[];
  teamMemberships: { memberRole: TeamMemberRole; team: Ref }[];
}

export interface Department extends Ref {
  description: string | null;
  isActive: boolean;
  parentId: string | null;
  _count: { users: number; teams: number; roles: number };
}

export interface Role extends Ref {
  key: string;
  description: string | null;
  isSystem: boolean;
  isMasterAdmin: boolean;
  isActive: boolean;
  department: Ref | null;
  reportsTo: Ref | null;
  permissions: { permissionKey: string }[];
  _count: { users: number };
}

export interface CatalogModule {
  key: string;
  name: string;
  phase: number;
  status: ModuleStatus;
  isCore: boolean;
  permissions: { key: string; description: string | null }[];
}

/** One module's access for one scope (usually one person), as shown on the Access screen. */
export interface ModuleAccess {
  key: string;
  name: string;
  description: string | null;
  phase: number;
  isCore: boolean;
  canViewOnly: boolean;
  preset: "DEFAULT" | "DENIED" | "VIEW_ONLY" | "FULL" | "CUSTOM";
  expiresAt: string | null;
}

export interface PermissionOverride {
  id: string;
  scopeType: OverrideScope;
  scopeId: string;
  permissionKey: string;
  effect: "ALLOW" | "DENY";
  note: string | null;
  createdAt: string;
}

export interface ModuleRow {
  key: string;
  name: string;
  description: string | null;
  isCore: boolean;
  phase: number;
  status: ModuleStatus;
  version: string;
  config: Record<string, unknown> | null;
  _count: { permissions: number };
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  privileged: boolean;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

export interface GatewayStatus {
  gatewayEnabled: boolean;
  codeVerified: boolean;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  privileged: boolean;
  privilegedUntil: string | null;
}

export interface SecurityOverview {
  settings: { gatewayEnabled: boolean; mfaRequired: boolean; sessionMinutes: number; codeConfigured: boolean };
  eligible: { id: string; name: string; email: string; status: UserStatus; mfaEnrolled: boolean }[];
  privilegedSessions: {
    id: string;
    ip: string | null;
    userAgent: string | null;
    privilegedUntil: string;
    lastSeenAt: string;
    current: boolean;
    user: Ref & { email: string };
  }[];
}

export interface MasterOverview {
  totals: { users: number; activeUsers: number; teams: number; events: number; activeEvents: number; roles: number };
  modules: Partial<Record<ModuleStatus, number>>;
  recentActivity: (Omit<AuditEntry, "actor"> & { actor: { name: string } | null })[];
}

// ── Phase 2 — work management ────────────────────────────────────────────────

export type TaskStatus =
  | "BACKLOG"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "IN_REVIEW"
  | "COMPLETED"
  | "CANCELLED";

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  percentage: number;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  parentTaskId: string | null;
  teamId: string | null;
  eventId: string | null;
  assignedToId: string | null;
  createdById: string | null;
  team: Ref | null;
  event: Ref | null;
  assignedTo: (Ref & { email: string; avatarUrl: string | null }) | null;
  createdBy: Ref | null;
  _count: { subtasks: number; updates: number };
}

export interface TaskUpdateEntry {
  id: string;
  percentage: number;
  summary: string;
  blockers: string | null;
  status: TaskStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  user: (Ref & { avatarUrl: string | null }) | null;
  reviewedBy: Ref | null;
}

export interface TaskDetail extends Task {
  parentTask: { id: string; title: string } | null;
  subtasks: Task[];
  updates: TaskUpdateEntry[];
  capabilities: { canUpdate: boolean; canSubmitUpdate: boolean; canReview: boolean; canDelete: boolean };
}

export interface TaskStats {
  total: number;
  completed: number;
  open: number;
  overdue: number;
  inReview: number;
  blocked: number;
  byStatus: Partial<Record<TaskStatus, number>>;
  progress: number;
  completionRate: number;
}

export interface TeamProgress {
  id: string;
  name: string;
  memberRole: TeamMemberRole;
  memberCount: number;
  stats: TaskStats;
}

// ── Phase 3 — meetings & attendance ──────────────────────────────────────────

export type MeetingType = "GOOGLE_MEET" | "INTERNAL" | "PHYSICAL" | "WORKSHOP" | "ONE_TO_ONE" | "EXTERNAL" | "EVENT" | "CUSTOM";
export type MeetingStatus = "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";
export type MeetingProvider = "MANUAL" | "GOOGLE_MEET_LINK" | "GOOGLE_MEET_API";
export type ParticipantRole = "HOST" | "CO_HOST" | "REQUIRED" | "OPTIONAL";
export type AttendanceStatus = "UNKNOWN" | "PRESENT" | "LATE" | "PARTIAL" | "ABSENT" | "EXCUSED";

export interface Meeting {
  id: string;
  title: string;
  description: string | null;
  type: MeetingType;
  status: MeetingStatus;
  provider: MeetingProvider;
  joinUrl: string | null;
  location: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  startedAt: string | null;
  endedAt: string | null;
  teamId: string | null;
  eventId: string | null;
  createdById: string | null;
  team: Ref | null;
  event: Ref | null;
  createdBy: Ref | null;
  _count: { participants: number; actionItems: number; decisions: number };
}

export interface MeetingParticipant {
  role: ParticipantRole;
  status: AttendanceStatus;
  statusManual: boolean;
  firstJoinAt: string | null;
  lastLeaveAt: string | null;
  minutes: number;
  note: string | null;
  user: Ref & { email: string; avatarUrl: string | null };
}

export interface MeetingDetail extends Meeting {
  agenda: string | null;
  notes: string | null;
  isParticipant: boolean;
  participants: MeetingParticipant[];
  sessions: { id: string; joinedAt: string; leftAt: string | null; source: "PROVIDER" | "MANUAL" | "SELF"; user: Ref }[];
  decisions: { id: string; text: string; createdAt: string; decidedBy: Ref | null }[];
  actionItems: {
    id: string;
    text: string;
    dueDate: string | null;
    createdAt: string;
    owner: Ref | null;
    task: { id: string; title: string; status: TaskStatus; percentage: number } | null;
  }[];
  capabilities: { canManage: boolean; canEnd: boolean; canJoin: boolean; canViewAttendance: boolean };
}

export interface AttendancePolicy {
  lateAfterMinutes: number;
  partialBelowPercent: number;
  absentBelowPercent: number;
}

export interface AttendanceStats {
  meetings: number;
  counts: Partial<Record<AttendanceStatus, number>>;
  minutes: number;
  attendanceRate: number;
  recent: {
    status: AttendanceStatus;
    minutes: number;
    user: Ref;
    meeting: Ref & { title: string; scheduledStart: string; team: Ref | null };
  }[];
}

// ── Phase 4 — operations ─────────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: string;
  createdAt: string;
  uploadedBy?: Ref | null;
}

export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  connectedEmail: string | null;
  connectedAt: string | null;
  folderName: string;
  redirectUri: string;
}

// Finance

export type ExpenseStatus = "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "REIMBURSED";
export type PaymentMethod = "CASH" | "UPI" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "OTHER";

export interface Budget extends Ref {
  amount: string;
  notes: string | null;
  createdAt: string;
  event: Ref | null;
  team: Ref | null;
  _count: { expenses: number };
}

export interface Expense {
  id: string;
  title: string;
  category: string;
  amount: string;
  paymentMethod: PaymentMethod;
  spentAt: string;
  description: string | null;
  status: ExpenseStatus;
  reviewedAt: string | null;
  reviewNote: string | null;
  reimbursedAt: string | null;
  reimbursedRef: string | null;
  createdAt: string;
  eventId: string | null;
  teamId: string | null;
  event: Ref | null;
  team: Ref | null;
  budget: Ref | null;
  paidBy: Ref | null;
  submittedBy: Ref | null;
  reviewedBy: Ref | null;
}

export interface ExpenseDetail extends Expense {
  capabilities: { canEdit: boolean; canApprove: boolean; canDelete: boolean; canReview: boolean; blockedBySelfReview: boolean };
}

export interface FinanceSummary {
  allocated: number;
  spent: number;
  pending: number;
  remaining: number;
  pendingVerification: number;
  pendingReimbursement: { count: number; amount: number };
  byStatus: Partial<Record<ExpenseStatus, { count: number; amount: number }>>;
}

// Tickets

export type TicketStatus = "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "BLOCKED" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface Ticket {
  id: string;
  number: number;
  title: string;
  description: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  resolution: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  teamId: string | null;
  eventId: string | null;
  team: Ref | null;
  event: Ref | null;
  requester: (Ref & { avatarUrl: string | null }) | null;
  assignee: (Ref & { avatarUrl: string | null }) | null;
  _count: { activity: number };
}

export interface TicketActivityEntry {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
  user: (Ref & { avatarUrl: string | null }) | null;
}

export interface TicketDetail extends Ticket {
  activity: TicketActivityEntry[];
  capabilities: { canUpdate: boolean; canAssign: boolean };
}

export interface TicketStats {
  total: number;
  open: number;
  blocked: number;
  resolved: number;
  closed: number;
  byStatus: Partial<Record<TicketStatus, number>>;
}

// Ideas

export type IdeaStatus = "SUBMITTED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "IMPLEMENTING" | "IMPLEMENTED";

export interface Idea {
  id: string;
  title: string;
  category: string;
  summary: string;
  status: IdeaStatus;
  decisionNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  teamId: string | null;
  eventId: string | null;
  team: Ref | null;
  event: Ref | null;
  submittedBy: (Ref & { avatarUrl: string | null }) | null;
  reviewedBy: Ref | null;
}

export interface IdeaDetail extends Idea {
  capabilities: { canReview: boolean; canEdit: boolean };
}

export interface IdeaStats {
  total: number;
  awaitingReview: number;
  accepted: number;
  implemented: number;
  byStatus: Partial<Record<IdeaStatus, number>>;
}

// Opportunities

export type OpportunityType = "SPONSOR" | "GUEST" | "VENDOR" | "VENUE" | "COLLABORATION" | "INVITATION" | "PARTNER";
export type OpportunityStatus = "NEW" | "UNDER_REVIEW" | "CONTACTED" | "NEGOTIATING" | "CONFIRMED" | "REJECTED" | "CLOSED";

export interface Opportunity {
  id: string;
  type: OpportunityType;
  name: string;
  organizationName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  description: string | null;
  value: string | null;
  status: OpportunityStatus;
  nextActionAt: string | null;
  createdAt: string;
  updatedAt: string;
  teamId: string | null;
  eventId: string | null;
  team: Ref | null;
  event: Ref | null;
  owner: (Ref & { avatarUrl: string | null }) | null;
  createdBy: Ref | null;
  _count: { activity: number };
}

export interface OpportunityDetail extends Opportunity {
  activity: { id: string; kind: string; message: string; createdAt: string; user: Ref | null }[];
  capabilities: { canManage: boolean };
}

export interface OpportunityStats {
  total: number;
  byType: Partial<Record<OpportunityType, number>>;
  byStatus: Partial<Record<OpportunityStatus, number>>;
  confirmed: { count: number; value: number };
}
