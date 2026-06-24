import {
  ArrowRight,
  BookOpenText,
  Brain,
  CalendarBlank,
  CaretDown,
  ChartLineUp,
  CirclesThree,
  Clock,
  ClockCounterClockwise,
  Cpu,
  Gauge,
  GitBranch,
  LockSimple,
  MagnifyingGlass,
  PauseCircle,
  PlugsConnected,
  Pulse,
  SquaresFour,
  TerminalWindow,
  Timer,
  TrendUp,
  Warning,
  X,
  type Icon as PhosphorIcon
} from "@phosphor-icons/react";

export const iconRegistry = {
  sessions: Pulse,
  models: Cpu,
  alerts: Warning,
  logbook: BookOpenText,
  performance: ChartLineUp,
  usage: Gauge,

  search: MagnifyingGlass,
  harness: PlugsConnected,
  lifecycle: CirclesThree,
  recentActivity: ClockCounterClockwise,
  timeRange: CalendarBlank,
  refreshInterval: Timer,
  changeLayout: SquaresFour,

  runtime: Clock,
  model: Cpu,
  worktree: GitBranch,
  thinking: Brain,
  source: TerminalWindow,
  startedAt: CalendarBlank,
  lastActivity: ClockCounterClockwise,

  active: Pulse,
  idle: PauseCircle,
  blocked: LockSimple,

  selectChevron: CaretDown,
  trendUp: TrendUp,
  close: X,
  arrowRight: ArrowRight
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof iconRegistry;
