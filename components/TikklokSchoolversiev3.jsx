"use client";
import React, { useEffect, useMemo, useState } from "react";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Upload,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  User,
  CalendarDays,
  Wand2,
  Trash2,
  Plus,
  Download,
  Save,
  FileSpreadsheet,
  Search,
  RotateCcw,
  Filter,
  Check,
  X,
  School,
  MessageSquareWarning,
  ClipboardCheck,
  TimerReset,
  Shield,
  Printer,
  Layers3,
} from "lucide-react";

const CONFIG = {
  schoolDayStart: "08:00",
  schoolDayEnd: "17:30",
  lunchStart: "12:55",
  lunchEnd: "13:45",
  requiredWeekMinutes: 30 * 50,
  duplicateThresholdMinutes: 3,
  autoClipOpenSessionsToSchoolEnd: true,
  markLateArrivalAfter: "09:00",
  ignoreVeryShortSessionBelowMinutes: 1,
  shortageWarningMinutes: 100,
};

const STORAGE_KEYS = {
  corrections: "tikklok-corrections-v4",
  config: "tikklok-config-v4",
};

function pad(n) {
  return String(n).padStart(2, "0");
}

function timeToMinutes(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
}

function minutesToDisplay(minutes) {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}u ${pad(m)}m`;
}

function minutesToLessonValue(minutes) {
  return Number((minutes / 50).toFixed(2));
}

function parseDate(dateStr) {
  const [y, mo, d] = String(dateStr).split("/").map(Number);
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("nl-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function weekdayName(isoDate) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("nl-BE", { weekday: "long" });
}

function isoWeekString(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  const dayNr = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayNr + 3);
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const diff = date - firstThursday;
  const week = 1 + Math.round(diff / 604800000);
  return `${date.getFullYear()}-W${pad(week)}`;
}

function compareEvents(a, b) {
  const ta = timeToMinutes(a.time);
  const tb = timeToMinutes(b.time);
  if (ta !== tb) return ta - tb;
  return String(a.sourceNo || "").localeCompare(String(b.sourceNo || ""));
}

function overlap(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function downloadText(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[";,\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function sessionWorkedMinutes(startMin, endMin, config) {
  if (endMin <= startMin) return 0;
  let total = endMin - startMin;
  total -= overlap(startMin, endMin, timeToMinutes(config.lunchStart), timeToMinutes(config.lunchEnd));
  return Math.max(0, total);
}

function parseLogText(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const rows = [];

  for (const line of lines) {
    if (/^No\s*\t/i.test(line)) continue;
    const parts = line.split(/\t+/).map((part) => part.trim()).filter((part) => part !== "");
    if (parts.length < 7) continue;

    const [no, machine, eno, name, modeRaw, ioMd, dateTime] = parts;
    if (!/^\d+$/.test(no) || !dateTime.includes("/")) continue;

    const [datePart, timePart] = dateTime.split(/\s+/);
    const normalizedName = String(name).replace(/\s+/g, " ").trim();
    const mode = ioMd === "1" ? "IN" : ioMd === "2" ? "UIT" : `MODE_${ioMd}`;

    rows.push({
      no,
      machine,
      eno,
      name: normalizedName,
      modeRaw,
      ioMd,
      mode,
      date: parseDate(datePart),
      time: timePart,
      rawDateTime: dateTime,
    });
  }

  return rows.sort((a, b) => {
    const dateCompare = `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
    if (dateCompare !== 0) return dateCompare;
    return String(a.no).localeCompare(String(b.no));
  });
}

function detectRawIssues(events, config) {
  const issues = [];
  if (!events.length) return ["Geen tikken gevonden"];

  const first = events[0];
  const last = events[events.length - 1];
  if (first.mode !== "IN") issues.push("Dag begint niet met IN");
  if (last.mode !== "UIT") issues.push("Dag eindigt niet met UIT");
  if (events.length % 2 !== 0) issues.push("Oneven aantal tikken");
  if (timeToMinutes(first.time) > timeToMinutes(config.markLateArrivalAfter)) issues.push(`Eerste tik na ${config.markLateArrivalAfter}`);

  for (let i = 0; i < events.length - 1; i += 1) {
    const current = events[i];
    const next = events[i + 1];
    const diff = timeToMinutes(next.time) - timeToMinutes(current.time);
    if (diff < 0) issues.push(`Niet-chronologische tikken rond ${current.time} en ${next.time}`);
    if (current.mode === next.mode) issues.push(`Dubbele ${current.mode}-tik rond ${current.time} en ${next.time}`);
    if (diff >= 0 && diff <= config.duplicateThresholdMinutes) {
      issues.push(`Mogelijke dubbeltik binnen ${config.duplicateThresholdMinutes} min rond ${current.time} en ${next.time}`);
    }
  }

  return Array.from(new Set(issues));
}

function autoNormalizeEvents(rawEvents, config) {
  const sorted = [...rawEvents].sort(compareEvents);
  const cleaned = [];
  const suggestions = [];

  for (const ev of sorted) {
    const previous = cleaned[cleaned.length - 1];
    if (!previous) {
      cleaned.push({ ...ev, inferred: false });
      continue;
    }

    const diff = timeToMinutes(ev.time) - timeToMinutes(previous.time);
    if (ev.mode === previous.mode && diff >= 0 && diff <= config.duplicateThresholdMinutes) {
      suggestions.push(`Dubbeltik genegeerd: ${ev.time} (${ev.mode})`);
      continue;
    }

    cleaned.push({ ...ev, inferred: false });
  }

  const normalized = [];
  let expect = "IN";

  for (const ev of cleaned) {
    if (ev.mode === expect) {
      normalized.push(ev);
      expect = expect === "IN" ? "UIT" : "IN";
      continue;
    }

    if (expect === "UIT" && ev.mode === "IN") {
      const inferredTime = timeToMinutes(ev.time) >= timeToMinutes(config.lunchEnd) ? config.lunchStart : ev.time;
      normalized.push({ time: inferredTime, mode: "UIT", sourceNo: `auto-before-${ev.time}`, inferred: true });
      suggestions.push(`Ontbrekende UIT toegevoegd vóór ${ev.time}`);
      normalized.push(ev);
      expect = "UIT";
      continue;
    }

    if (expect === "IN" && ev.mode === "UIT") {
      const inferredTime = timeToMinutes(ev.time) >= timeToMinutes(config.lunchEnd) ? config.lunchEnd : ev.time;
      normalized.push({ time: inferredTime, mode: "IN", sourceNo: `auto-before-${ev.time}`, inferred: true });
      suggestions.push(`Ontbrekende IN toegevoegd vóór ${ev.time}`);
      normalized.push(ev);
      expect = "IN";
      continue;
    }
  }

  if (normalized.length && normalized[normalized.length - 1].mode === "IN" && config.autoClipOpenSessionsToSchoolEnd) {
    normalized.push({
      time: config.schoolDayEnd,
      mode: "UIT",
      sourceNo: "auto-day-end",
      inferred: true,
    });
    suggestions.push(`Ontbrekende eindtik aangevuld op ${config.schoolDayEnd}`);
  }

  return { normalized: normalized.sort(compareEvents), suggestions: Array.from(new Set(suggestions)) };
}

function buildSessions(events, config) {
  const sorted = [...events].sort(compareEvents);
  const sessions = [];

  for (let i = 0; i < sorted.length - 1; i += 2) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (!start || !end) continue;
    if (start.mode !== "IN" || end.mode !== "UIT") continue;

    const startMin = timeToMinutes(start.time);
    const endMin = timeToMinutes(end.time);
    const worked = sessionWorkedMinutes(startMin, endMin, config);

    if (worked < config.ignoreVeryShortSessionBelowMinutes) continue;

    sessions.push({
      start: start.time,
      end: end.time,
      startMin,
      endMin,
      workedMinutes: worked,
      inferred: Boolean(start.inferred || end.inferred),
    });
  }

  return sessions;
}

function calculateDay(events, config) {
  const sessions = buildSessions(events, config);
  const workedMinutes = sessions.reduce((sum, session) => sum + session.workedMinutes, 0);
  return {
    sessions,
    workedMinutes,
    lessons: minutesToLessonValue(workedMinutes),
  };
}

function makeDayKey(studentKey, date) {
  return `${studentKey}__${date}`;
}

function serializeEvents(events) {
  return events.map((ev) => ({
    time: ev.time,
    mode: ev.mode,
    sourceNo: ev.sourceNo || "manual",
    inferred: Boolean(ev.inferred),
  }));
}

function hydrateCorrectionEvents(events) {
  return Array.isArray(events)
    ? events.map((ev, index) => ({
        time: ev.time || "13:45",
        mode: ev.mode === "UIT" ? "UIT" : "IN",
        sourceNo: ev.sourceNo || `saved-${index}`,
        inferred: Boolean(ev.inferred),
      }))
    : [];
}

function buildDataset(rows, correctionsByDay, config) {
  const grouped = new Map();

  for (const row of rows) {
    const studentKey = `${row.eno}__${row.name}`;
    const dayKey = makeDayKey(studentKey, row.date);
    if (!grouped.has(dayKey)) {
      grouped.set(dayKey, {
        dayKey,
        studentKey,
        eno: row.eno,
        name: row.name,
        date: row.date,
        week: isoWeekString(row.date),
        rawEvents: [],
      });
    }
    grouped.get(dayKey).rawEvents.push({
      time: row.time,
      mode: row.mode,
      sourceNo: row.no,
      inferred: false,
    });
  }

  const days = Array.from(grouped.values())
    .map((day) => {
      const rawEvents = day.rawEvents.sort(compareEvents);
      const rawIssues = detectRawIssues(rawEvents, config);
      const auto = autoNormalizeEvents(rawEvents, config);
      const savedCorrection = correctionsByDay[day.dayKey];
      const correctedEvents = savedCorrection ? hydrateCorrectionEvents(savedCorrection.correctedEvents) : auto.normalized;
      const calculated = calculateDay(correctedEvents, config);
      const remainingIssues = detectRawIssues(correctedEvents, config);
      const forgotPunch = rawIssues.some((issue) =>
        ["Dag begint niet met IN", "Dag eindigt niet met UIT", "Oneven aantal tikken"].includes(issue)
      );
      const needsReview = Boolean(rawIssues.length) || Boolean(savedCorrection?.forceReview);
      const status = savedCorrection?.approved
        ? "goedgekeurd"
        : remainingIssues.length
          ? "controle nodig"
          : needsReview
            ? "nazicht"
            : "ok";

      return {
        ...day,
        rawEvents,
        suggestions: auto.suggestions,
        correctedEvents,
        sessions: calculated.sessions,
        workedMinutes: calculated.workedMinutes,
        lessons: calculated.lessons,
        rawIssues,
        remainingIssues,
        forgotPunch,
        needsReview,
        status,
        savedCorrection: savedCorrection || null,
      };
    })
    .sort((a, b) => `${a.date}-${a.name}`.localeCompare(`${b.date}-${b.name}`));

  const studentMap = new Map();
  for (const day of days) {
    if (!studentMap.has(day.studentKey)) {
      studentMap.set(day.studentKey, {
        studentKey: day.studentKey,
        eno: day.eno,
        name: day.name,
        week: day.week,
        days: [],
      });
    }
    studentMap.get(day.studentKey).days.push(day);
  }

  const students = Array.from(studentMap.values())
    .map((student) => {
      const totalMinutes = student.days.reduce((sum, day) => sum + day.workedMinutes, 0);
      const approvedCount = student.days.filter((d) => d.status === "goedgekeurd").length;
      const issueCount = student.days.filter((d) => d.status !== "ok" && d.status !== "goedgekeurd").length;
      const forgotPunchCount = student.days.filter((d) => d.forgotPunch).length;
      const balanceMinutes = totalMinutes - config.requiredWeekMinutes;
      const progress = Math.max(0, Math.min(100, (totalMinutes / config.requiredWeekMinutes) * 100));
      let weeklyStatus = "in orde";
      if (balanceMinutes < 0 && Math.abs(balanceMinutes) >= config.shortageWarningMinutes) weeklyStatus = "tekort";
      else if (balanceMinutes < 0) weeklyStatus = "bijna in orde";

      return {
        ...student,
        totalMinutes,
        totalLessons: minutesToLessonValue(totalMinutes),
        balanceMinutes,
        approvedCount,
        issueCount,
        forgotPunchCount,
        progress,
        weeklyStatus,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const weekMap = new Map();
  for (const student of students) {
    if (!weekMap.has(student.week)) weekMap.set(student.week, []);
    weekMap.get(student.week).push(student);
  }

  return {
    days,
    students,
    weeks: weekMap,
  };
}

function statusBadgeVariant(status) {
  if (status === "ok") return "ok";
  if (status === "goedgekeurd") return "approved";
  if (status === "controle nodig") return "danger";
  return "warning";
}

function StatusBadge({ status }) {
  const variant = statusBadgeVariant(status);
  const className =
    variant === "ok"
      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
      : variant === "approved"
        ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
        : variant === "danger"
          ? "bg-rose-100 text-rose-800 hover:bg-rose-100"
          : "bg-amber-100 text-amber-800 hover:bg-amber-100";
  return <Badge className={`rounded-xl ${className}`}>{status}</Badge>;
}

function WeekStatusBadge({ status }) {
  const className =
    status === "in orde"
      ? "bg-emerald-100 text-emerald-800"
      : status === "bijna in orde"
        ? "bg-amber-100 text-amber-800"
        : "bg-rose-100 text-rose-800";
  return <Badge className={`rounded-xl ${className}`}>{status}</Badge>;
}

function StatCard({ title, value, subtitle, icon }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <div className="text-sm font-medium text-slate-500">{title}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 break-words">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-2 text-slate-700">{icon}</div>
      </CardContent>
    </Card>
  );
}

function SmallIssue({ children, tone = "neutral" }) {
  const toneClass =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return <div className={`rounded-xl border p-3 text-sm ${toneClass}`}>{children}</div>;
}

function DayTimeline({ events, config }) {
  const startMin = timeToMinutes(config.schoolDayStart);
  const endMin = timeToMinutes(config.schoolDayEnd);
  const lunchStartMin = timeToMinutes(config.lunchStart);
  const lunchEndMin = timeToMinutes(config.lunchEnd);

  const lunchLeft = ((lunchStartMin - startMin) / (endMin - startMin)) * 100;
  const lunchWidth = ((lunchEndMin - lunchStartMin) / (endMin - startMin)) * 100;

  return (
    <div className="rounded-2xl border bg-slate-50 p-4">
      <div className="mb-3 text-sm font-medium">Visuele daglijn</div>
      <div className="relative h-20 rounded-xl bg-white p-3">
        <div className="absolute inset-x-3 top-1/2 h-1 -translate-y-1/2 rounded bg-slate-200" />
        <div
          className="absolute top-1/2 h-6 -translate-y-1/2 rounded bg-amber-100/80"
          style={{ left: `calc(${lunchLeft}% + 12px)`, width: `calc(${lunchWidth}% - 0px)` }}
        />
        {events.map((ev, index) => {
          const minute = timeToMinutes(ev.time);
          const left = `${Math.min(100, Math.max(0, ((minute - startMin) / (endMin - startMin)) * 100))}%`;
          return (
            <div key={`${ev.sourceNo}-${index}-${ev.time}`} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `calc(${left} + 12px)` }}>
              <div className={`h-4 w-4 rounded-full border-2 ${ev.mode === "IN" ? "border-emerald-600 bg-emerald-200" : "border-rose-600 bg-rose-200"}`} />
              <div className="mt-1 text-center text-[10px] text-slate-600">{ev.time}</div>
            </div>
          );
        })}
        <div className="absolute bottom-1 left-3 text-[10px] text-slate-500">{config.schoolDayStart}</div>
        <div className="absolute bottom-1 right-3 text-[10px] text-slate-500">{config.schoolDayEnd}</div>
        <div className="absolute top-1 right-3 rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
          middag {config.lunchStart}–{config.lunchEnd}
        </div>
      </div>
    </div>
  );
}

function buildFeedback(student, config) {
  const tekortLessen = Math.max(0, Math.ceil(Math.abs(Math.min(0, student.balanceMinutes)) / 50));

  if (student.balanceMinutes >= 0 && student.forgotPunchCount === 0 && student.issueCount === 0) {
    return `${student.name} heeft deze week zijn uren correct geregistreerd en behaalt de weeknorm van ${minutesToLessonValue(config.requiredWeekMinutes)} lessen. Alles is in orde.`;
  }

  const parts = [];
  parts.push(`${student.name} behaalt momenteel ${student.totalLessons} lessen op een weeknorm van ${minutesToLessonValue(config.requiredWeekMinutes)} lessen.`);

  if (student.balanceMinutes < 0) {
    parts.push(`Er is dus een tekort van ${tekortLessen} les${tekortLessen === 1 ? "" : "sen"} (${minutesToDisplay(Math.abs(student.balanceMinutes))}).`);
  }

  if (student.forgotPunchCount > 0) {
    parts.push(`Er ${student.forgotPunchCount === 1 ? "werd 1 dag" : `werden ${student.forgotPunchCount} dagen`} met een vermoedelijk vergeten tik vastgesteld.`);
  }

  if (student.issueCount > 0) {
    parts.push(`Er ${student.issueCount === 1 ? "blijft 1 dag" : `blijven ${student.issueCount} dagen`} met controle of opvolging nodig.`);
  }

  parts.push("Gelieve de tikregistratie nauwkeuriger op te volgen.");
  return parts.join(" ");
}

function buildPrintableReport(student, config) {
  if (!student) return "";
  const rowsHtml = student.days
    .map(
      (day) => `
        <tr>
          <td>${formatDate(day.date)}</td>
          <td>${weekdayName(day.date)}</td>
          <td>${minutesToDisplay(day.workedMinutes)}</td>
          <td>${day.lessons}</td>
          <td>${day.status}</td>
          <td>${day.forgotPunch ? "ja" : "nee"}</td>
        </tr>`
    )
    .join("");

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Rapportfiche ${student.name}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
          h1, h2, h3 { margin: 0 0 10px 0; }
          .box { border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px; margin-bottom: 16px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; font-size: 14px; }
          th { background: #f8fafc; }
          @media print { body { padding: 8px; } }
        </style>
      </head>
      <body>
        <h1>Tikklok rapportfiche</h1>
        <div class="box">
          <strong>Leerling:</strong> ${student.name}<br />
          <strong>Leerlingnummer:</strong> ${student.eno}<br />
          <strong>Week:</strong> ${student.week}
        </div>
        <div class="grid">
          <div class="box"><strong>Totaal geregistreerd</strong><br />${minutesToDisplay(student.totalMinutes)} (${student.totalLessons} lessen)</div>
          <div class="box"><strong>Saldo tegenover norm</strong><br />${minutesToDisplay(student.balanceMinutes)}</div>
          <div class="box"><strong>Weekstatus</strong><br />${student.weeklyStatus}</div>
          <div class="box"><strong>Vergeten tikken</strong><br />${student.forgotPunchCount}</div>
        </div>
        <div class="box">
          <h3>Automatische feedback</h3>
          <div>${buildFeedback(student, config)}</div>
        </div>
        <div class="box">
          <h3>Dagenoverzicht</h3>
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Dag</th>
                <th>Minuten</th>
                <th>Lessen</th>
                <th>Status</th>
                <th>Vergeten tik</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </body>
    </html>`;
}

export default function TikklokSchoolversieV3() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [studentFilter, setStudentFilter] = useState("all");
  const [dayStatusFilter, setDayStatusFilter] = useState("all");
  const [selectedStudentKey, setSelectedStudentKey] = useState("");
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [selectedWeek, setSelectedWeek] = useState("all");
  const [activeRole, setActiveRole] = useState("teacher");
  const [editedEvents, setEditedEvents] = useState([]);
  const [notes, setNotes] = useState("");
  const [approved, setApproved] = useState(false);
  const [forceReview, setForceReview] = useState(false);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [config, setConfig] = useState(() => {
    if (typeof window === "undefined") return CONFIG;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.config);
      return raw ? { ...CONFIG, ...JSON.parse(raw) } : CONFIG;
    } catch {
      return CONFIG;
    }
  });
  const [correctionsByDay, setCorrectionsByDay] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.corrections);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.corrections, JSON.stringify(correctionsByDay));
    }
  }, [correctionsByDay]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
    }
  }, [config]);

  const dataset = useMemo(() => buildDataset(rows, correctionsByDay, config), [rows, correctionsByDay, config]);
  const availableWeeks = useMemo(() => Array.from(dataset.weeks.keys()).sort(), [dataset.weeks]);

  const filteredStudents = useMemo(() => {
    let students = [...dataset.students];

    if (selectedWeek !== "all") students = students.filter((student) => student.week === selectedWeek);
    if (studentFilter === "issues") students = students.filter((student) => student.issueCount > 0);
    if (studentFilter === "approved") students = students.filter((student) => student.approvedCount > 0);
    if (studentFilter === "shortage") students = students.filter((student) => student.balanceMinutes < 0);
    if (studentFilter === "forgot") students = students.filter((student) => student.forgotPunchCount > 0);

    if (search.trim()) {
      const needle = search.toLowerCase();
      students = students.filter((student) => student.name.toLowerCase().includes(needle) || student.eno.toLowerCase().includes(needle));
    }

    return students;
  }, [dataset.students, selectedWeek, studentFilter, search]);

  const selectedStudent = useMemo(() => {
    return filteredStudents.find((student) => student.studentKey === selectedStudentKey) || filteredStudents[0] || null;
  }, [filteredStudents, selectedStudentKey]);

  const visibleDays = useMemo(() => {
    if (!selectedStudent) return [];
    let days = [...selectedStudent.days];
    if (dayStatusFilter === "issues") days = days.filter((day) => day.status === "controle nodig" || day.status === "nazicht");
    if (dayStatusFilter === "ok") days = days.filter((day) => day.status === "ok" || day.status === "goedgekeurd");
    if (dayStatusFilter === "forgot") days = days.filter((day) => day.forgotPunch);
    return days;
  }, [selectedStudent, dayStatusFilter]);

  const selectedDay = useMemo(() => {
    return visibleDays.find((day) => day.dayKey === selectedDayKey) || selectedStudent?.days[0] || null;
  }, [visibleDays, selectedDayKey, selectedStudent]);

  useEffect(() => {
    if (filteredStudents.length && !filteredStudents.some((student) => student.studentKey === selectedStudentKey)) {
      setSelectedStudentKey(filteredStudents[0].studentKey);
    }
  }, [filteredStudents, selectedStudentKey]);

  useEffect(() => {
    if (selectedDay) {
      setSelectedDayKey(selectedDay.dayKey);
      setEditedEvents(serializeEvents(selectedDay.correctedEvents));
      setNotes(selectedDay.savedCorrection?.notes || "");
      setApproved(Boolean(selectedDay.savedCorrection?.approved));
      setForceReview(Boolean(selectedDay.savedCorrection?.forceReview));
    }
  }, [selectedDay?.dayKey]);

  function handleUpload(fileOrFiles) {
    const files = fileOrFiles instanceof FileList ? Array.from(fileOrFiles) : Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    const validFiles = files.filter(Boolean);
    if (!validFiles.length) return;

    Promise.all(
      validFiles.map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(String(event.target?.result || ""));
            reader.readAsText(file, "utf-8");
          })
      )
    ).then((texts) => {
      const parsedRows = texts.flatMap((text) => parseLogText(text));
      setRows(parsedRows);
      setSelectedStudentKey("");
      setSelectedDayKey("");
      setSelectedWeek("all");
    });
  }

  function updateEvent(index, key, value) {
    setEditedEvents((previous) =>
      previous
        .map((event, i) => (i === index ? { ...event, [key]: value } : event))
        .sort(compareEvents)
    );
  }

  function removeEvent(index) {
    setEditedEvents((previous) => previous.filter((_, i) => i !== index));
  }

  function addEvent() {
    setEditedEvents((previous) => [...previous, { time: config.lunchEnd, mode: "IN", sourceNo: `manual-${Date.now()}`, inferred: false }].sort(compareEvents));
  }

  function applyAutoProposal() {
    if (!selectedDay) return;
    const auto = autoNormalizeEvents(selectedDay.rawEvents, config);
    setEditedEvents(serializeEvents(auto.normalized));
  }

  function saveCorrection() {
    if (!selectedDay) return;
    setCorrectionsByDay((previous) => ({
      ...previous,
      [selectedDay.dayKey]: {
        correctedEvents: serializeEvents(editedEvents),
        notes,
        approved,
        forceReview,
        savedAt: new Date().toISOString(),
      },
    }));
  }

  function resetCorrection() {
    if (!selectedDay) return;
    const updated = { ...correctionsByDay };
    delete updated[selectedDay.dayKey];
    setCorrectionsByDay(updated);
    setEditedEvents(serializeEvents(selectedDay.correctedEvents));
    setNotes("");
    setApproved(false);
    setForceReview(false);
  }

  function exportDayJson() {
    if (!selectedDay) return;
    const calculated = calculateDay(editedEvents, config);
    const payload = {
      leerling: selectedDay.name,
      leerlingnummer: selectedDay.eno,
      datum: selectedDay.date,
      week: selectedDay.week,
      rawEvents: selectedDay.rawEvents,
      correctedEvents: editedEvents,
      notes,
      approved,
      forceReview,
      workedMinutes: calculated.workedMinutes,
      sessions: calculated.sessions,
      exportedAt: new Date().toISOString(),
    };
    downloadText(`correctie_${selectedDay.name.replace(/\s+/g, "_")}_${selectedDay.date}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  }

  function exportWeekCsv() {
    const lines = [
      ["week", "leerlingnummer", "naam", "totaal_minuten", "totaal_lessen", "saldo_minuten", "controle_dagen", "goedgekeurde_dagen", "vergeten_tikken", "weekstatus"].join(";"),
      ...dataset.students.map((student) =>
        [
          csvEscape(student.week),
          csvEscape(student.eno),
          csvEscape(student.name),
          csvEscape(student.totalMinutes),
          csvEscape(student.totalLessons),
          csvEscape(student.balanceMinutes),
          csvEscape(student.issueCount),
          csvEscape(student.approvedCount),
          csvEscape(student.forgotPunchCount),
          csvEscape(student.weeklyStatus),
        ].join(";")
      ),
    ];
    downloadText("weekoverzicht_tikklok_schoolklaar.csv", lines.join("\n"), "text/csv;charset=utf-8");
  }

  function exportDayAuditCsv() {
    const lines = [
      ["datum", "week", "leerlingnummer", "naam", "status", "minuten", "lessen", "vergeten_tik", "raw_issues", "remaining_issues", "opmerking"].join(";"),
      ...dataset.days.map((day) =>
        [
          csvEscape(day.date),
          csvEscape(day.week),
          csvEscape(day.eno),
          csvEscape(day.name),
          csvEscape(day.status),
          csvEscape(day.workedMinutes),
          csvEscape(day.lessons),
          csvEscape(day.forgotPunch ? "ja" : "nee"),
          csvEscape(day.rawIssues.join(" | ")),
          csvEscape(day.remainingIssues.join(" | ")),
          csvEscape(day.savedCorrection?.notes || ""),
        ].join(";")
      ),
    ];
    downloadText("dagaudit_tikklok_schoolklaar.csv", lines.join("\n"), "text/csv;charset=utf-8");
  }

  function exportFeedbackCsv() {
    const lines = [
      ["week", "leerlingnummer", "naam", "feedback"].join(";"),
      ...dataset.students.map((student) =>
        [csvEscape(student.week), csvEscape(student.eno), csvEscape(student.name), csvEscape(buildFeedback(student, config))].join(";")
      ),
    ];
    downloadText("feedback_tikklok_leerlingen.csv", lines.join("\n"), "text/csv;charset=utf-8");
  }

  function printStudentReport() {
    if (!selectedStudent) return;
    const reportWindow = window.open("", "_blank", "width=900,height=1200");
    if (!reportWindow) return;
    reportWindow.document.open();
    reportWindow.document.write(buildPrintableReport(selectedStudent, config));
    reportWindow.document.close();
    reportWindow.focus();
    setTimeout(() => reportWindow.print(), 300);
  }

  const editedCalculation = useMemo(() => calculateDay(editedEvents, config), [editedEvents, config]);
  const editedRemainingIssues = useMemo(() => detectRawIssues(editedEvents, config), [editedEvents, config]);

  const stats = useMemo(() => {
    const reviewDays = dataset.days.filter((day) => day.status === "controle nodig" || day.status === "nazicht").length;
    const approvedDays = dataset.days.filter((day) => day.status === "goedgekeurd").length;
    const forgotPunchDays = dataset.days.filter((day) => day.forgotPunch).length;
    const shortageStudents = dataset.students.filter((student) => student.balanceMinutes < 0).length;
    return {
      tikken: rows.length,
      leerlingen: dataset.students.length,
      reviewDays,
      approvedDays,
      forgotPunchDays,
      shortageStudents,
      weeks: availableWeeks.length,
    };
  }, [rows.length, dataset.days, dataset.students, availableWeeks.length]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tikklok controlecentrum · schoolversie v3</h1>
            <p className="mt-1 text-sm text-slate-600">
              Meerdere weken tegelijk, afdrukbare rapportfiche per leerling en aparte administrator- en leerkrachtweergave.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-sm hover:bg-slate-800">
              <Upload className="h-4 w-4" />
              <span>Logbestanden uploaden</span>
              <input type="file" multiple accept=".txt,.csv,.log" className="hidden" onChange={(e) => e.target.files && handleUpload(e.target.files)} />
            </label>
            <Button variant="outline" className="rounded-2xl" onClick={exportWeekCsv} disabled={!rows.length}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Week CSV
            </Button>
            <Button variant="outline" className="rounded-2xl" onClick={exportDayAuditCsv} disabled={!rows.length}>
              <Download className="mr-2 h-4 w-4" /> Audit CSV
            </Button>
            <Button variant="outline" className="rounded-2xl" onClick={exportFeedbackCsv} disabled={!rows.length}>
              <ClipboardCheck className="mr-2 h-4 w-4" /> Feedback CSV
            </Button>
          </div>
        </div>

        {!rows.length ? (
          <Alert className="rounded-2xl border-dashed">
            <School className="h-4 w-4" />
            <AlertTitle>Nog geen logbestand geladen</AlertTitle>
            <AlertDescription>
              Upload één of meerdere exportbestanden. Het systeem voegt de tikken samen en bouwt daarna automatisch de controle-interface op.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
              <StatCard title="Tikken" value={stats.tikken} subtitle="ingelezen records" icon={<Clock3 className="h-4 w-4" />} />
              <StatCard title="Leerlingen" value={stats.leerlingen} subtitle="unieke gebruikers" icon={<User className="h-4 w-4" />} />
              <StatCard title="Weken" value={stats.weeks} subtitle="ingelezen weken" icon={<Layers3 className="h-4 w-4" />} />
              <StatCard title="Controle" value={stats.reviewDays} subtitle="dagen in wachtrij" icon={<AlertTriangle className="h-4 w-4" />} />
              <StatCard title="Goedgekeurd" value={stats.approvedDays} subtitle="bevestigde dagen" icon={<CheckCircle2 className="h-4 w-4" />} />
              <StatCard title="Vergeten tik" value={stats.forgotPunchDays} subtitle="dagen met vermoeden" icon={<TimerReset className="h-4 w-4" />} />
              <StatCard title="Tekort" value={stats.shortageStudents} subtitle="leerlingen onder 30u" icon={<MessageSquareWarning className="h-4 w-4" />} />
            </div>

            <Tabs defaultValue="overview" className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <TabsList className="grid w-full max-w-2xl grid-cols-3 rounded-2xl">
                  <TabsTrigger value="overview">Overzicht</TabsTrigger>
                  <TabsTrigger value="review">Controle</TabsTrigger>
                  <TabsTrigger value="settings">Instellingen</TabsTrigger>
                </TabsList>
                <div className="flex gap-2">
                  <Button variant={activeRole === "teacher" ? "default" : "outline"} className="rounded-xl" onClick={() => setActiveRole("teacher")}>
                    Leerkracht
                  </Button>
                  <Button variant={activeRole === "admin" ? "default" : "outline"} className="rounded-xl" onClick={() => setActiveRole("admin")}>
                    <Shield className="mr-2 h-4 w-4" /> Administrator
                  </Button>
                </div>
              </div>

              <TabsContent value="overview">
                <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
                  <Card className="rounded-2xl shadow-sm">
                    <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <CardTitle>Weekoverzicht per leerling</CardTitle>
                        <CardDescription>Gebaseerd op een weeknorm van {minutesToLessonValue(config.requiredWeekMinutes)} lessen.</CardDescription>
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                        <div className="relative min-w-[220px]">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek leerling of nummer" className="rounded-xl pl-9" />
                        </div>
                        <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                          <SelectTrigger className="w-full rounded-xl sm:w-[170px]">
                            <SelectValue placeholder="Week" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Alle weken</SelectItem>
                            {availableWeeks.map((week) => (
                              <SelectItem key={week} value={week}>{week}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={studentFilter} onValueChange={setStudentFilter}>
                          <SelectTrigger className="w-full rounded-xl sm:w-[220px]">
                            <Filter className="mr-2 h-4 w-4" />
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Alle leerlingen</SelectItem>
                            <SelectItem value="issues">Enkel met issues</SelectItem>
                            <SelectItem value="approved">Met goedkeuring</SelectItem>
                            <SelectItem value="shortage">Enkel tekort</SelectItem>
                            <SelectItem value="forgot">Vergeten tikken</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="w-full">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Leerling</TableHead>
                              <TableHead>Nr</TableHead>
                              <TableHead>Week</TableHead>
                              <TableHead>Totaal</TableHead>
                              <TableHead>Lessen</TableHead>
                              <TableHead>Saldo</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Vergeten tik</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredStudents.map((student) => (
                              <TableRow
                                key={student.studentKey}
                                className="cursor-pointer"
                                onClick={() => {
                                  setSelectedStudentKey(student.studentKey);
                                  setSelectedDayKey(student.days[0]?.dayKey || "");
                                }}
                              >
                                <TableCell className="font-medium">{student.name}</TableCell>
                                <TableCell>{student.eno}</TableCell>
                                <TableCell>{student.week}</TableCell>
                                <TableCell>{minutesToDisplay(student.totalMinutes)}</TableCell>
                                <TableCell>{student.totalLessons}</TableCell>
                                <TableCell>
                                  <span className={student.balanceMinutes >= 0 ? "text-emerald-700" : "text-rose-700"}>{minutesToDisplay(student.balanceMinutes)}</span>
                                </TableCell>
                                <TableCell><WeekStatusBadge status={student.weeklyStatus} /></TableCell>
                                <TableCell>{student.forgotPunchCount}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  <div className="space-y-4">
                    <Card className="rounded-2xl shadow-sm">
                      <CardHeader>
                        <CardTitle>Korte uitleg</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm text-slate-700">
                        <SmallIssue tone="success">Je kan nu meerdere logbestanden tegelijk uploaden en de weken samen analyseren.</SmallIssue>
                        <SmallIssue tone="warning">Gebruik de weekfilter om snel tussen verschillende weeksets te wisselen.</SmallIssue>
                        <SmallIssue>De middagpauze {config.lunchStart}–{config.lunchEnd} wordt automatisch niet meegeteld.</SmallIssue>
                        <SmallIssue>Correcties worden lokaal in de browser bewaard zolang je op hetzelfde toestel werkt.</SmallIssue>
                      </CardContent>
                    </Card>

                    {selectedStudent && (
                      <Card className="rounded-2xl shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between gap-3">
                          <div>
                            <CardTitle>Feedback leerling</CardTitle>
                            <CardDescription>Korte tekst voor opvolging, mail of rapport.</CardDescription>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" className="rounded-xl" onClick={() => setFeedbackDialogOpen(true)}>
                              <ClipboardCheck className="mr-2 h-4 w-4" /> Toon tekst
                            </Button>
                            <Button variant="outline" className="rounded-xl" onClick={printStudentReport}>
                              <Printer className="mr-2 h-4 w-4" /> Rapportfiche
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <SmallIssue>{buildFeedback(selectedStudent, config)}</SmallIssue>
                        </CardContent>
                      </Card>
                    )}

                    {activeRole === "admin" && (
                      <Card className="rounded-2xl shadow-sm">
                        <CardHeader>
                          <CardTitle>Administratorsoverzicht</CardTitle>
                          <CardDescription>Snel zicht op de globale situatie over alle ingelezen weken.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-slate-700">
                          <SmallIssue>Ingelezen weken: {availableWeeks.length}</SmallIssue>
                          <SmallIssue tone="warning">Leerlingen met tekort: {dataset.students.filter((student) => student.balanceMinutes < 0).length}</SmallIssue>
                          <SmallIssue tone="danger">Dagen met controle nodig: {dataset.days.filter((day) => day.status === "controle nodig" || day.status === "nazicht").length}</SmallIssue>
                          <SmallIssue tone="success">Goedgekeurde dagen: {dataset.days.filter((day) => day.status === "goedgekeurd").length}</SmallIssue>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="review">
                <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
                  <Card className="rounded-2xl shadow-sm">
                    <CardHeader>
                      <CardTitle>Leerlingen en dagen</CardTitle>
                      <CardDescription>Kies een leerling en daarna een dag om te valideren.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Leerling</label>
                        <Select value={selectedStudent?.studentKey || ""} onValueChange={setSelectedStudentKey}>
                          <SelectTrigger className="rounded-xl">
                            <SelectValue placeholder="Kies leerling" />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredStudents.map((student) => (
                              <SelectItem key={student.studentKey} value={student.studentKey}>
                                {student.name} · {student.week}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Dagfilter</label>
                        <Select value={dayStatusFilter} onValueChange={setDayStatusFilter}>
                          <SelectTrigger className="rounded-xl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Alle dagen</SelectItem>
                            <SelectItem value="issues">Enkel controle</SelectItem>
                            <SelectItem value="ok">Enkel ok / goedgekeurd</SelectItem>
                            <SelectItem value="forgot">Enkel vergeten tik</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <ScrollArea className="h-[620px] pr-2">
                        <div className="space-y-2">
                          {visibleDays.map((day) => (
                            <button
                              key={day.dayKey}
                              onClick={() => setSelectedDayKey(day.dayKey)}
                              className={`w-full rounded-2xl border p-3 text-left transition ${selectedDayKey === day.dayKey ? "border-slate-900 bg-slate-900 text-white" : "bg-white hover:bg-slate-50"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="font-medium">{formatDate(day.date)}</div>
                                  <div className={`text-xs ${selectedDayKey === day.dayKey ? "text-slate-300" : "text-slate-500"}`}>{weekdayName(day.date)}</div>
                                </div>
                                <StatusBadge status={day.status} />
                              </div>
                              <div className={`mt-2 text-sm ${selectedDayKey === day.dayKey ? "text-slate-200" : "text-slate-600"}`}>
                                {minutesToDisplay(day.workedMinutes)} · {day.lessons} lessen
                              </div>
                              {day.forgotPunch && (
                                <div className={`mt-2 text-xs ${selectedDayKey === day.dayKey ? "text-amber-200" : "text-amber-700"}`}>
                                  vermoedelijk vergeten tik
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  {selectedDay ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-4">
                        <StatCard title="Leerling" value={selectedDay.name} subtitle={selectedDay.eno} icon={<User className="h-4 w-4" />} />
                        <StatCard title="Datum" value={formatDate(selectedDay.date)} subtitle={weekdayName(selectedDay.date)} icon={<CalendarDays className="h-4 w-4" />} />
                        <StatCard title="Minuten" value={minutesToDisplay(editedCalculation.workedMinutes)} subtitle={`${editedCalculation.lessons} lessen`} icon={<Clock3 className="h-4 w-4" />} />
                        <StatCard title="Status" value={selectedDay.status} subtitle={selectedDay.week} icon={<CheckCircle2 className="h-4 w-4" />} />
                      </div>

                      <div className="grid gap-4 2xl:grid-cols-[1.2fr_0.8fr]">
                        <Card className="rounded-2xl shadow-sm">
                          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <CardTitle>Correctiescherm</CardTitle>
                              <CardDescription>Pas tikken aan, voeg ontbrekende tikken toe en keur daarna de dag goed.</CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" className="rounded-xl" onClick={addEvent}>
                                <Plus className="mr-2 h-4 w-4" /> Tik toevoegen
                              </Button>
                              <Button variant="outline" className="rounded-xl" onClick={applyAutoProposal}>
                                <Wand2 className="mr-2 h-4 w-4" /> Auto-voorstel
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <DayTimeline events={editedEvents} config={config} />

                            <div className="space-y-3">
                              {editedEvents.map((ev, index) => (
                                <div key={`${ev.sourceNo}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-3 rounded-2xl border p-3">
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-slate-500">Tijd</label>
                                    <Input type="time" value={ev.time} onChange={(e) => updateEvent(index, "time", e.target.value)} className="rounded-xl" />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-slate-500">Type</label>
                                    <Select value={ev.mode} onValueChange={(value) => updateEvent(index, "mode", value)}>
                                      <SelectTrigger className="rounded-xl">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="IN">IN</SelectItem>
                                        <SelectItem value="UIT">UIT</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="flex items-end">
                                    <Button variant="ghost" className="rounded-xl" onClick={() => removeEvent(index)}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <label className="flex items-center gap-3 rounded-2xl border p-3">
                                <Checkbox checked={approved} onCheckedChange={(value) => setApproved(Boolean(value))} />
                                <div>
                                  <div className="font-medium">Dag goedkeuren</div>
                                  <div className="text-xs text-slate-500">Deze dag telt als nagekeken en bevestigd</div>
                                </div>
                              </label>
                              <label className="flex items-center gap-3 rounded-2xl border p-3">
                                <Checkbox checked={forceReview} onCheckedChange={(value) => setForceReview(Boolean(value))} />
                                <div>
                                  <div className="font-medium">Controle behouden</div>
                                  <div className="text-xs text-slate-500">Hou deze dag zichtbaar in de controlewachtrij</div>
                                </div>
                              </label>
                            </div>

                            <div>
                              <label className="mb-2 block text-sm font-medium">Opmerking</label>
                              <Textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className="min-h-[120px] rounded-xl"
                                placeholder="Bijvoorbeeld: leerling vergat uit te tikken vóór de middag; einduur bevestigd door leerkracht."
                              />
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button className="rounded-xl" onClick={saveCorrection}>
                                <Save className="mr-2 h-4 w-4" /> Opslaan
                              </Button>
                              <Button variant="outline" className="rounded-xl" onClick={resetCorrection}>
                                <RotateCcw className="mr-2 h-4 w-4" /> Reset opgeslagen correctie
                              </Button>
                              <Button variant="outline" className="rounded-xl" onClick={exportDayJson}>
                                <Download className="mr-2 h-4 w-4" /> Exporteer dag JSON
                              </Button>
                            </div>
                          </CardContent>
                        </Card>

                        <div className="space-y-4">
                          <Card className="rounded-2xl shadow-sm">
                            <CardHeader>
                              <CardTitle>Analyse</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              <div>
                                <div className="mb-2 text-sm font-medium">Ruwe problemen</div>
                                <div className="space-y-2">
                                  {selectedDay.rawIssues.length ? (
                                    selectedDay.rawIssues.map((issue, index) => <SmallIssue key={index} tone="danger">{issue}</SmallIssue>)
                                  ) : (
                                    <SmallIssue tone="success">Geen problemen in de ruwe data</SmallIssue>
                                  )}
                                </div>
                              </div>

                              <div>
                                <div className="mb-2 text-sm font-medium">Automatische voorstellen</div>
                                <div className="space-y-2">
                                  {selectedDay.suggestions.length ? (
                                    selectedDay.suggestions.map((suggestion, index) => <SmallIssue key={index} tone="warning">{suggestion}</SmallIssue>)
                                  ) : (
                                    <SmallIssue>Geen extra voorstel nodig</SmallIssue>
                                  )}
                                </div>
                              </div>

                              <div>
                                <div className="mb-2 text-sm font-medium">Issues na bewerking</div>
                                <div className="space-y-2">
                                  {editedRemainingIssues.length ? (
                                    editedRemainingIssues.map((issue, index) => <SmallIssue key={index} tone="warning">{issue}</SmallIssue>)
                                  ) : (
                                    <SmallIssue tone="success">Dag is logisch opgebouwd en klaar voor validatie.</SmallIssue>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>

                          <Card className="rounded-2xl shadow-sm">
                            <CardHeader>
                              <CardTitle>Berekende sessies</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-2">
                                {editedCalculation.sessions.length ? (
                                  editedCalculation.sessions.map((session, index) => (
                                    <div key={index} className="rounded-xl border p-3 text-sm">
                                      <div className="font-medium">{session.start} → {session.end}</div>
                                      <div className="text-slate-600">{minutesToDisplay(session.workedMinutes)}{session.inferred ? " · deels afgeleid" : ""}</div>
                                    </div>
                                  ))
                                ) : (
                                  <SmallIssue>Geen geldige sessies gevonden.</SmallIssue>
                                )}
                              </div>
                            </CardContent>
                          </Card>

                          <Card className="rounded-2xl shadow-sm">
                            <CardHeader>
                              <CardTitle>Snelle acties</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                              <Button variant="outline" className="w-full justify-start rounded-xl" onClick={() => {
                                setEditedEvents((prev) => [...prev, { time: config.lunchStart, mode: "UIT", sourceNo: `quick-uit-${Date.now()}`, inferred: true }].sort(compareEvents));
                              }}>
                                <X className="mr-2 h-4 w-4" /> Voeg UIT toe op middagstart
                              </Button>
                              <Button variant="outline" className="w-full justify-start rounded-xl" onClick={() => {
                                setEditedEvents((prev) => [...prev, { time: config.lunchEnd, mode: "IN", sourceNo: `quick-in-${Date.now()}`, inferred: true }].sort(compareEvents));
                              }}>
                                <Check className="mr-2 h-4 w-4" /> Voeg IN toe op middageinde
                              </Button>
                            </CardContent>
                          </Card>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Card className="rounded-2xl shadow-sm">
                      <CardContent className="p-10 text-center text-slate-500">Geen dag geselecteerd.</CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="settings">
                <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                  <Card className="rounded-2xl shadow-sm">
                    <CardHeader>
                      <CardTitle>Schoolregels</CardTitle>
                      <CardDescription>Pas de logica aan zonder in de code te werken.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium">Schooldag start</label>
                        <Input type="time" value={config.schoolDayStart} onChange={(e) => setConfig((prev) => ({ ...prev, schoolDayStart: e.target.value }))} className="rounded-xl" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">Schooldag einde</label>
                        <Input type="time" value={config.schoolDayEnd} onChange={(e) => setConfig((prev) => ({ ...prev, schoolDayEnd: e.target.value }))} className="rounded-xl" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">Middag start</label>
                        <Input type="time" value={config.lunchStart} onChange={(e) => setConfig((prev) => ({ ...prev, lunchStart: e.target.value }))} className="rounded-xl" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">Middag einde</label>
                        <Input type="time" value={config.lunchEnd} onChange={(e) => setConfig((prev) => ({ ...prev, lunchEnd: e.target.value }))} className="rounded-xl" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">Weeknorm in minuten</label>
                        <Input type="number" value={config.requiredWeekMinutes} onChange={(e) => setConfig((prev) => ({ ...prev, requiredWeekMinutes: Number(e.target.value || 0) }))} className="rounded-xl" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">Dubbeltik drempel (min)</label>
                        <Input type="number" value={config.duplicateThresholdMinutes} onChange={(e) => setConfig((prev) => ({ ...prev, duplicateThresholdMinutes: Number(e.target.value || 0) }))} className="rounded-xl" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">Te laat na</label>
                        <Input type="time" value={config.markLateArrivalAfter} onChange={(e) => setConfig((prev) => ({ ...prev, markLateArrivalAfter: e.target.value }))} className="rounded-xl" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">Waarschuwing tekort (min)</label>
                        <Input type="number" value={config.shortageWarningMinutes} onChange={(e) => setConfig((prev) => ({ ...prev, shortageWarningMinutes: Number(e.target.value || 0) }))} className="rounded-xl" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl shadow-sm">
                    <CardHeader>
                      <CardTitle>Implementatienota</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-700">
                      <SmallIssue>Deze versie ondersteunt meerdere uploads tegelijk en groepeert alles per ISO-week.</SmallIssue>
                      <SmallIssue>Per leerling is er nu een afdrukbare rapportfiche voorzien met dagenoverzicht en automatische feedback.</SmallIssue>
                      <SmallIssue>De administratorweergave geeft snel zicht op globale tekorten, controles en goedkeuringen.</SmallIssue>
                      <SmallIssue>De leerkrachtweergave blijft gericht op detailcontrole en individuele opvolging.</SmallIssue>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <Dialog open={feedbackDialogOpen} onOpenChange={setFeedbackDialogOpen}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>Feedback voor leerling</DialogTitle>
            <DialogDescription>Kopieer deze tekst voor mail, klassenraad of opvolging.</DialogDescription>
          </DialogHeader>
          <Textarea value={selectedStudent ? buildFeedback(selectedStudent, config) : ""} readOnly className="min-h-[220px] rounded-xl" />
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => {
              if (!selectedStudent) return;
              navigator.clipboard.writeText(buildFeedback(selectedStudent, config));
            }}>
              Kopieer tekst
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
