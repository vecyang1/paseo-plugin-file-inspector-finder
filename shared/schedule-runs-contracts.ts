import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ScheduleRunStatusSchema = z.enum([
  "succeeded",
  "failed",
  "running",
  "cancelled",
  "unknown",
]);

export type ScheduleRunStatus = z.infer<typeof ScheduleRunStatusSchema>;

export const ScheduleRunEntrySchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  scheduleName: z.string(),
  status: ScheduleRunStatusSchema,
  scheduledFor: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  durationFormatted: z.string(),
  agentId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  isArchived: z.boolean(),
  output: z.string(),
  outputPreview: z.string(),
  error: z.string().nullable(),
});

export type ScheduleRunEntry = z.infer<typeof ScheduleRunEntrySchema>;

export const ScheduleRunsSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "paused", "expired", "completed", "unknown"]),
  isStandbyTwin: z.boolean(),
  standbySlug: z.string().nullable(),
  cronExpression: z.string(),
  timezone: z.string(),
  provider: z.string(),
  model: z.string(),
  modeId: z.string(),
  cwd: z.string(),
  archiveOnFinish: z.boolean(),
  prompt: z.string(),
  promptPreview: z.string(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  totalRuns: z.number(),
  succeededRuns: z.number(),
  failedRuns: z.number(),
  runningRuns: z.number(),
  lastRunStatus: z.string().nullable(),
  runs: z.array(ScheduleRunEntrySchema),
});

export type ScheduleRunsSummary = z.infer<typeof ScheduleRunsSummarySchema>;

export const ScheduleRunTimelineMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  text: z.string(),
  timestamp: z.string().nullable(),
});

export type ScheduleRunTimelineMessage = z.infer<
  typeof ScheduleRunTimelineMessageSchema
>;

export const inspectScheduleRunsRpc = defineRpc({
  name: "finder.inspect_schedule_runs",
  input: z.object({
    scheduleId: z.string().optional(),
    query: z.string().optional(),
    onlyWithRuns: z.boolean().default(false),
    includeWorkspaceNames: z.boolean().default(false),
    maxRunsPerSchedule: z.number().int().min(1).max(200).default(50),
    compactSummary: z.boolean().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    schedulesDir: z.string(),
    totalSchedules: z.number(),
    schedulesWithRuns: z.number(),
    totalRuns: z.number(),
    succeededRuns: z.number(),
    failedRuns: z.number(),
    runningRuns: z.number(),
    schedules: z.array(ScheduleRunsSummarySchema),
    recentRuns: z.array(ScheduleRunEntrySchema),
    workspaceScheduleMap: z
      .record(
        z.string(),
        z.object({
          scheduleId: z.string(),
          scheduleName: z.string(),
          isRunning: z.boolean(),
          runStatus: z.string(),
        }),
      )
      .default({}),
    projectLastActiveByKey: z.record(z.string(), z.string()).default({}),
    durationMs: z.number(),
    message: z.string(),
  }),
});

export const openScheduleRunSessionRpc = defineRpc({
  name: "finder.open_schedule_run_session",
  input: z.object({
    action: z
      .enum([
        "open-run",
        "preview-timeline",
        "run-now",
        "toggle-archive-on-finish",
        "recover-due",
        "auto-evolve",
      ])
      .default("open-run"),
    scheduleId: z.string().default(""),
    runId: z.string().optional(),
    workspaceId: z.string().optional(),
    agentId: z.string().optional(),
    archiveOnFinish: z.boolean().optional(),
    dryRun: z.boolean().default(false),
  }),
  output: z.object({
    ok: z.boolean(),
    action: z.enum([
      "open-run",
      "preview-timeline",
      "run-now",
      "toggle-archive-on-finish",
      "recover-due",
      "auto-evolve",
    ]),
    scheduleId: z.string(),
    scheduleName: z.string(),
    runId: z.string().nullable(),
    workspaceId: z.string().nullable(),
    workspaceName: z.string().nullable(),
    agentId: z.string().nullable(),
    unarchived: z.boolean(),
    archiveOnFinish: z.boolean().nullable(),
    timelineEntries: z.array(ScheduleRunTimelineMessageSchema),
    output: z.string(),
    error: z.string().nullable(),
    durationMs: z.number(),
    message: z.string(),
  }),
});
