import fs from "node:fs";
import path from "node:path";

export type NewsItem = {
  title: string;
  link?: string;
  summary?: string;
  date?: string;
  source?: string;
};

export type GithubHotItem = {
  name: string;
  url?: string;
  description?: string;
  chineseMeaning?: string;
  language?: string;
  stars?: string;
  starsToday?: string;
  source?: string;
};

export type DailyReport = {
  date: string;
  generatedAt?: string;
  timezone?: string;
  newsCount?: number;
  githubCount?: number;
  news: NewsItem[];
  githubHot: GithubHotItem[];
  sourceWarnings?: string[];
};

export type ReportSummary = {
  date: string;
  generatedAt?: string;
  newsCount: number;
  githubCount: number;
  firstNewsTitle?: string;
  firstGithubName?: string;
};

const REPORT_DIR = path.join(process.cwd(), "daily-tech");

function isReport(value: unknown): value is DailyReport {
  const report = value as DailyReport;
  return Boolean(
    report &&
      typeof report.date === "string" &&
      Array.isArray(report.news) &&
      Array.isArray(report.githubHot),
  );
}

function reportPath(date: string) {
  return path.join(REPORT_DIR, `${date}.json`);
}

export function getReportDates() {
  if (!fs.existsSync(REPORT_DIR)) return [];

  return fs
    .readdirSync(REPORT_DIR)
    .filter((fileName) => /^\d{4}-\d{2}-\d{2}\.json$/.test(fileName))
    .map((fileName) => fileName.replace(/\.json$/, ""))
    .sort((a, b) => b.localeCompare(a));
}

export function getReport(date: string) {
  const filePath = reportPath(date);
  if (!fs.existsSync(filePath)) return null;

  try {
    const report = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isReport(report) ? report : null;
  } catch {
    return null;
  }
}

export function getAllReports() {
  return getReportDates()
    .map((date) => getReport(date))
    .filter((report): report is DailyReport => Boolean(report));
}

export function getReportSummaries(): ReportSummary[] {
  return getAllReports().map((report) => ({
    date: report.date,
    generatedAt: report.generatedAt,
    newsCount: report.newsCount ?? report.news.length,
    githubCount: report.githubCount ?? report.githubHot.length,
    firstNewsTitle: report.news[0]?.title,
    firstGithubName: report.githubHot[0]?.name,
  }));
}

export function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(parsed);
}

export function formatDateTime(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(parsed);
}

export function githubMarkdownUrl(date: string) {
  return `https://github.com/Farr1102/daily-tech-archive/blob/main/daily-tech/${date}.md`;
}

export function githubJsonUrl(date: string) {
  return `https://github.com/Farr1102/daily-tech-archive/blob/main/daily-tech/${date}.json`;
}
