import Image from "next/image";
import Link from "next/link";
import { formatDate, formatDateTime, getReportSummaries } from "@/lib/reports";

export default function HomePage() {
  const reports = getReportSummaries();
  const latest = reports[0];
  const totalNews = reports.reduce((sum, report) => sum + report.newsCount, 0);
  const totalGithub = reports.reduce((sum, report) => sum + report.githubCount, 0);

  return (
    <main>
      <section className="topbar">
        <div className="shell nav">
          <Link className="brand" href="/">
            <Image src="/archive-mark.svg" alt="" width={38} height={38} priority />
            <span>Daily Tech Archive</span>
          </Link>
          <a
            className="navLink"
            href="https://github.com/Farr1102/daily-tech-archive"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </section>

      <section className="hero">
        <div className="shell heroGrid">
          <div>
            <p className="eyebrow">Tech News / GitHub Trending</p>
            <h1>科技日报归档</h1>
            <p className="lead">
              每天固定归档 10 条科技新闻和 5 个 GitHub 热点，保留结构化 JSON 与 Markdown 版本。
            </p>
          </div>
          <div className="metricPanel" aria-label="归档统计">
            <div>
              <span>{reports.length}</span>
              <p>日报</p>
            </div>
            <div>
              <span>{totalNews}</span>
              <p>新闻</p>
            </div>
            <div>
              <span>{totalGithub}</span>
              <p>仓库</p>
            </div>
          </div>
        </div>
      </section>

      <section className="contentBand">
        <div className="shell">
          {latest ? (
            <Link className="latestStrip" href={`/report/${latest.date}`}>
              <span>最新归档</span>
              <strong>{formatDate(latest.date)}</strong>
              <em>{latest.newsCount} 条新闻 · {latest.githubCount} 个 GitHub 热点</em>
            </Link>
          ) : (
            <div className="emptyState">
              <strong>还没有日报归档</strong>
              <p>n8n 第一次成功提交后，这里会自动出现列表。</p>
            </div>
          )}

          <div className="sectionTitle">
            <h2>全部日报</h2>
            <p>{reports.length ? "按日期倒序排列" : "等待第一份归档"}</p>
          </div>

          <div className="reportList">
            {reports.map((report) => (
              <Link className="reportRow" href={`/report/${report.date}`} key={report.date}>
                <div>
                  <strong>{formatDate(report.date)}</strong>
                  <p>{report.firstNewsTitle || "科技新闻归档"}</p>
                </div>
                <div>
                  <span>{report.newsCount} 新闻</span>
                  <span>{report.githubCount} GitHub</span>
                  {report.generatedAt ? <small>{formatDateTime(report.generatedAt)}</small> : null}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
