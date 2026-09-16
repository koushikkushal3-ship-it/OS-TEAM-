/**
 * Default TEAM OS catalog: module registry, permission keys and the initial
 * organization structure. Used by the seed script. After seeding, everything
 * here is editable by Master Admin — nothing in the running app is hard-coded to it.
 */

export interface ModuleDef {
  key: string;
  name: string;
  description: string;
  phase: number;
  isCore?: boolean;
  permissions: Record<string, string>;
}

export const MODULES: ModuleDef[] = [
  // ── Core (Phase 1, cannot be disabled) ───────────────────
  {
    key: 'core',
    name: 'Organization',
    description: 'Organization, departments, people, roles and permissions.',
    phase: 1,
    isCore: true,
    permissions: {
      'dashboard.view': 'Open the personal dashboard',
      'organization.view': 'View organization profile',
      'department.view': 'View departments',
      'department.create': 'Create departments',
      'department.update': 'Edit departments',
      'department.delete': 'Delete departments',
      'user.view': 'View people directory',
      'user.create': 'Invite people',
      'user.update': 'Edit people',
      'user.disable': 'Disable people',
    },
  },
  {
    key: 'teams',
    name: 'Teams',
    description: 'Teams, leads, co-leads and members.',
    phase: 1,
    isCore: true,
    permissions: {
      'team.view': 'View teams',
      'team.create': 'Create teams',
      'team.update': 'Edit teams',
      'team.remove': 'Remove teams',
      'team.manage_members': 'Add/remove members, leads and co-leads',
    },
  },
  {
    key: 'events',
    name: 'Events',
    description: 'Events and the teams working on them.',
    phase: 1,
    isCore: true,
    permissions: {
      'event.view': 'View events',
      'event.create': 'Create events',
      'event.update': 'Edit events',
      'event.delete': 'Delete events',
      'event.manage_teams': 'Add/remove teams and members on events',
    },
  },
  {
    key: 'administration',
    name: 'Administration',
    description: 'Master Admin control plane capabilities.',
    phase: 1,
    isCore: true,
    permissions: {
      'role.view': 'View roles',
      'role.manage': 'Create, edit and delete roles',
      'permission.manage': 'Change permissions and overrides',
      'module.view': 'View module registry',
      'module.configure': 'Enable, disable and configure modules',
      'audit.view': 'View audit logs',
      'security.manage': 'Manage gateway, MFA and privileged sessions',
    },
  },
  // ── Module registry (arch doc §11) ────────────────────────
  {
    key: 'tasks',
    name: 'Tasks',
    description: 'Tasks, assignment, daily work updates and progress.',
    phase: 2,
    permissions: {
      'task.view': 'View tasks',
      'task.create': 'Create tasks',
      'task.assign': 'Assign tasks',
      'task.update': 'Update tasks',
      'task.delete': 'Delete tasks',
      'work_update.create': 'Submit daily work updates',
      'work_update.review': 'Review work updates',
    },
  },
  {
    key: 'meetings',
    name: 'Meetings',
    description: 'Meeting center with Google Meet integration.',
    phase: 3,
    permissions: {
      'meeting.view': 'View meetings',
      'meeting.create': 'Create meetings',
      'meeting.join': 'Join meetings',
      'meeting.end': 'End meetings',
      'meeting.manage': 'Manage meeting notes, actions and artifacts',
    },
  },
  {
    key: 'attendance',
    name: 'Attendance',
    description: 'Meeting attendance derived from participant sessions.',
    phase: 3,
    permissions: {
      'attendance.view': 'View attendance',
      'attendance.manage': 'Correct attendance and configure thresholds',
    },
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'Budgets, expenses, invoices, payments and reimbursements.',
    phase: 4,
    permissions: {
      'finance.view': 'View finance',
      'finance.create': 'Create expenses',
      'finance.upload_invoice': 'Upload invoices and payment proof',
      'finance.edit': 'Edit financial records',
      'finance.approve': 'Approve or reject expenses',
      'finance.export': 'Export financial data',
      'finance.delete': 'Delete financial records',
    },
  },
  {
    key: 'documents',
    name: 'Documents',
    description: 'Files attached to any record.',
    phase: 4,
    permissions: {
      'document.view': 'View documents',
      'document.upload': 'Upload documents',
      'document.delete': 'Delete documents',
    },
  },
  {
    key: 'ideas',
    name: 'Ideas',
    description: 'Formal, document-based idea submissions.',
    phase: 4,
    permissions: {
      'idea.view': 'View ideas',
      'idea.submit': 'Submit ideas',
      'idea.review': 'Review ideas',
    },
  },
  {
    key: 'tickets',
    name: 'Tickets',
    description: 'Operational issue tickets.',
    phase: 4,
    permissions: {
      'ticket.view': 'View tickets',
      'ticket.create': 'Create tickets',
      'ticket.assign': 'Assign tickets',
      'ticket.update': 'Update and resolve tickets',
    },
  },
  {
    key: 'sponsors',
    name: 'Sponsors',
    description: 'Sponsor opportunities.',
    phase: 4,
    permissions: { 'sponsor.view': 'View sponsors', 'sponsor.manage': 'Manage sponsors' },
  },
  {
    key: 'guests',
    name: 'Guests',
    description: 'Guests and speakers.',
    phase: 4,
    permissions: { 'guest.view': 'View guests', 'guest.manage': 'Manage guests' },
  },
  {
    key: 'vendors',
    name: 'Vendors',
    description: 'Vendors and quotations.',
    phase: 4,
    permissions: { 'vendor.view': 'View vendors', 'vendor.manage': 'Manage vendors' },
  },
  {
    key: 'venues',
    name: 'Venues',
    description: 'Venues and shortlists.',
    phase: 4,
    permissions: { 'venue.view': 'View venues', 'venue.manage': 'Manage venues' },
  },
  {
    key: 'invitations',
    name: 'Invitations',
    description: 'Invitations and collaborations.',
    phase: 4,
    permissions: {
      'invitation.view': 'View invitations and collaborations',
      'invitation.manage': 'Manage invitations and collaborations',
    },
  },
  {
    key: 'reports',
    name: 'Reports',
    description: 'Daily, weekly, team, event and executive reports.',
    phase: 5,
    permissions: { 'report.view': 'View reports', 'report.export': 'Export reports' },
  },
  {
    key: 'notifications',
    name: 'Notifications',
    description: 'In-app and email notifications.',
    phase: 3,
    permissions: { 'notification.view': 'View notifications' },
  },
  // ── Platform features ─────────────────────────────────────
  {
    key: 'leave',
    name: 'Leave',
    description: 'Leave and availability requests.',
    phase: 7,
    permissions: { 'leave.request': 'Request leave', 'leave.approve': 'Approve or reject leave requests' },
  },
  {
    key: 'shifts',
    name: 'Shifts',
    description: 'Volunteer shift planning for events.',
    phase: 7,
    permissions: {
      'shift.view': 'View event shifts',
      'shift.signup': 'Sign up for shifts',
      'shift.manage': 'Create shifts and assign people',
    },
  },
  {
    key: 'schedule',
    name: 'Schedule',
    description: 'Organization schedule, mirrored to Google Calendar.',
    phase: 7,
    permissions: { 'schedule.view': 'See the organization schedule', 'schedule.manage': 'Add, edit and remove schedule entries' },
  },
  {
    key: 'kudos',
    name: 'Kudos',
    description: 'Public thanks between teammates.',
    phase: 7,
    permissions: { 'kudos.view': 'See kudos', 'kudos.give': 'Give kudos' },
  },
];

/** Modules whose implementation exists today — the seed enables these. */
export const BUILT_MODULES = [
  'core',
  'teams',
  'events',
  'administration',
  'tasks',
  'meetings',
  'attendance',
  'finance',
  'documents',
  'ideas',
  'tickets',
  'sponsors',
  'guests',
  'vendors',
  'venues',
  'invitations',
  'reports',
  'notifications',
  'leave',
  'shifts',
  'kudos',
  'schedule',
];

export const ALL_PERMISSION_KEYS = MODULES.flatMap((m) => Object.keys(m.permissions));

// ── Default permission bundles (Master Plan page 5 capability matrix) ────────

const MEMBER = [
  'dashboard.view',
  'user.view',
  'team.view',
  'event.view',
  'task.view',
  'work_update.create',
  'meeting.view',
  'meeting.join',
  'attendance.view',
  'document.view',
  'document.upload',
  'idea.view',
  'idea.submit',
  'ticket.view',
  'ticket.create',
  'invitation.view',
  'notification.view',
  'leave.request',
  'shift.view',
  'shift.signup',
  'kudos.view',
  'kudos.give',
  'schedule.view',
];

const LEAD = [
  ...MEMBER,
  'team.update',
  'team.manage_members',
  'task.create',
  'task.assign',
  'task.update',
  'work_update.review',
  'meeting.create',
  'meeting.end',
  'meeting.manage',
  'report.view',
  'leave.approve',
  'shift.manage',
  'schedule.manage',
];

const OPERATIONS = [
  ...LEAD,
  'event.update',
  'event.manage_teams',
  'attendance.manage',
  'finance.view',
  'finance.create',
  'finance.upload_invoice',
  'finance.edit',
  'finance.approve',
  'ticket.assign',
  'ticket.update',
  'sponsor.view',
  'sponsor.manage',
  'guest.view',
  'guest.manage',
  'vendor.view',
  'vendor.manage',
  'venue.view',
  'venue.manage',
  'invitation.manage',
  'idea.review',
  'report.export',
];

const ADMINISTRATION = [
  ...OPERATIONS,
  'organization.view',
  'department.view',
  'department.create',
  'department.update',
  'user.create',
  'user.update',
  'user.disable',
  'team.create',
  'team.remove',
  'event.create',
  'event.delete',
  'finance.export',
  'role.view',
  'module.view',
  'audit.view',
  'task.delete',
  'document.delete',
];

export const PERMISSION_BUNDLES = { MEMBER, LEAD, OPERATIONS, ADMINISTRATION };

// ── Initial organization structure (arch doc §5) ─────────────────────────────

export interface RoleDef {
  key: string;
  name: string;
  department: string;
  reportsTo?: string;
  permissions: string[];
  isMasterAdmin?: boolean;
  description?: string;
}

export const DEPARTMENTS = [
  { name: 'Executive', description: 'Founder, Co-Founder and CEO' },
  { name: 'Administration', description: 'Administrators and management' },
  { name: 'Operations', description: 'Operation leads, pilots and the operations team' },
  { name: 'Technical', description: 'Technical lead and team' },
  { name: 'Content', description: 'Content lead and team' },
  { name: 'Creative', description: 'Creative & designing lead and team' },
  { name: 'Host', description: 'Host lead and team' },
  { name: 'Digital', description: 'Digital lead and team' },
];

const functional = (dept: string, leadName: string): RoleDef[] => {
  const slug = dept.toLowerCase();
  return [
    {
      key: `${slug}_lead`,
      name: leadName,
      department: dept,
      reportsTo: 'operation_lead',
      permissions: LEAD,
    },
    {
      key: `${slug}_member`,
      name: `${dept} Team Member`,
      department: dept,
      reportsTo: `${slug}_lead`,
      permissions: MEMBER,
    },
  ];
};

export const ROLES: RoleDef[] = [
  {
    key: 'master_admin',
    name: 'Master Admin',
    department: 'Administration',
    permissions: [],
    isMasterAdmin: true,
    description: 'Hidden control plane. Full access while in a privileged session.',
  },
  { key: 'founder', name: 'Founder', department: 'Executive', permissions: ADMINISTRATION },
  { key: 'co_founder', name: 'Co-Founder', department: 'Executive', reportsTo: 'founder', permissions: ADMINISTRATION },
  { key: 'ceo', name: 'CEO', department: 'Executive', reportsTo: 'founder', permissions: ADMINISTRATION },
  { key: 'administrator', name: 'Administrator', department: 'Administration', reportsTo: 'ceo', permissions: ADMINISTRATION },
  { key: 'management', name: 'Management', department: 'Administration', reportsTo: 'ceo', permissions: ADMINISTRATION },
  { key: 'operation_lead', name: 'Operation Lead', department: 'Operations', reportsTo: 'management', permissions: OPERATIONS },
  { key: 'pilot', name: 'Pilot', department: 'Operations', reportsTo: 'operation_lead', permissions: OPERATIONS },
  { key: 'operations_member', name: 'Operations Team Member', department: 'Operations', reportsTo: 'operation_lead', permissions: MEMBER },
  ...functional('Technical', 'Technical Lead'),
  ...functional('Content', 'Content Lead'),
  ...functional('Creative', 'Creative & Designing Lead'),
  ...functional('Host', 'Host Lead'),
  ...functional('Digital', 'Digital Lead'),
];

export const TEAMS = [
  { name: 'Operations Team', department: 'Operations' },
  { name: 'Technical Team', department: 'Technical' },
  { name: 'Content Team', department: 'Content' },
  { name: 'Creative Team', department: 'Creative' },
  { name: 'Host Team', department: 'Host' },
  { name: 'Digital Team', department: 'Digital' },
];
