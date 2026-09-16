import {
  BarChart3,
  CalendarCheck2,
  CalendarDays,
  Gauge,
  HeartHandshake,
  Plane,
  Timer,
  CalendarRange,
  ClipboardList,
  Handshake,
  LayoutDashboard,
  Lightbulb,
  type LucideIcon,
  Mail,
  Ticket,
  UserCheck,
  Users,
  Video,
  Wallet,
  Contact,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Module key from the backend registry; hidden if disabled, "Soon" if planned. */
  module: string;
  /** Optional permission required to show the item. */
  permission?: string;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

/** The five top-level user areas (arch doc §13). Master Admin is intentionally absent. */
export const NAV: NavSection[] = [
  {
    id: "01",
    label: "Home",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "core" },
      { href: "/work", label: "My Work", icon: ClipboardList, module: "tasks" },
      { href: "/schedule", label: "Schedule", icon: CalendarCheck2, module: "schedule" },
      { href: "/calendar", label: "My calendar", icon: CalendarDays, module: "core" },
      { href: "/leave", label: "Leave", icon: Plane, module: "leave" },
      { href: "/kudos", label: "Kudos", icon: HeartHandshake, module: "kudos" },
    ],
  },
  {
    id: "02",
    label: "Teams & Events",
    items: [
      { href: "/teams", label: "Teams", icon: Users, module: "teams" },
      { href: "/events", label: "Events", icon: CalendarRange, module: "events" },
      { href: "/people", label: "People", icon: Contact, module: "core", permission: "user.view" },
      { href: "/shifts", label: "Shifts", icon: Timer, module: "shifts" },
      { href: "/workload", label: "Workload", icon: Gauge, module: "tasks", permission: "task.assign" },
    ],
  },
  {
    id: "03",
    label: "Meetings",
    items: [
      { href: "/meetings", label: "Meetings", icon: Video, module: "meetings" },
      { href: "/attendance", label: "Attendance", icon: UserCheck, module: "attendance" },
    ],
  },
  {
    id: "04",
    label: "Operations",
    items: [
      { href: "/operations", label: "Sponsors & Vendors", icon: Handshake, module: "sponsors" },
      { href: "/finance", label: "Finance", icon: Wallet, module: "finance" },
      { href: "/tickets", label: "Tickets", icon: Ticket, module: "tickets" },
      { href: "/invitations", label: "Invitations", icon: Mail, module: "invitations" },
    ],
  },
  {
    id: "05",
    label: "Knowledge",
    items: [
      { href: "/ideas", label: "Ideas", icon: Lightbulb, module: "ideas" },
      { href: "/reports", label: "Reports", icon: BarChart3, module: "reports" },
    ],
  },
];
