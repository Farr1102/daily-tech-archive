import Link from "next/link";
import { notFound } from "next/navigation";
import {
  formatDate,
  formatDateTime,
  getReport,
  getReportDates,
  githubJsonUrl,
  githubMarkdownUrl,
} from "@/lib/reports";

const externalLinkProps = {
  target: "_blank",
  rel: "noopener noreferrer",
};

type PageProps = {
  params: Promise<{ date: string }>;
};

export function generateStaticParams() {
  return getReportDates().map((date) => ({ date }));
}

export default async function ReportPage({ params }: PageProps) {
  const { date } = await params;
  const report = getReport(date);
  if (!report) notFound();

  return (
    <main>
      <section className="topbar">
        <div className="shell nav">
          <Link className="brand" href="/">
            <span className="markSmall" />
            <span>Daily Tech Archive</span>
          </Link>
          <Link className="navLink" href="/">
            全部日报
          </Link>
        </div>
      </section>

      <section className="reportHero">
        <div className="shell reportHeader">
          <p className="eyebrow">Report</p>
          <h1>{formatDate(report.date)}</h1>
          <p>
            {report.generatedAt ? `生成时间：${formatDateTime(report.generatedAt)}` : "结构化日报归档"}
            {report.timezone ? ` · ${report.timezone}` : ""}
          </p>
          <div className="sourceLinks">
            <a href={githubMarkdownUrl(report.date)} {...externalLinkProps}>
              Markdown
            </a>
            <a href={githubJsonUrl(report.date)} {...externalLinkProps}>
              JSON
            </a>
          </div>
        </div>
      </section>

      <section className="contentBand">
        <div className="shell twoColumn">
          <div>
            <div className="sectionTitle tight">
              <h2>科技新闻</h2>
              <p>{report.news.length} 条</p>
            </div>
            <div className="itemStack">
              {report.news.map((item, index) => (
                <article className="itemCard" key={`${item.link || item.title}-${index}`}>
                  <span className="index">{String(index + 1).padStart(2, "0")}</span>
                  <h3>
                    {item.link ? (
                      <a href={item.link} {...externalLinkProps}>
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </h3>
                  <p>{item.summary || "暂无摘要"}</p>
                  <div className="metaLine">
                    <span>{item.source || "未知来源"}</span>
                    <span>{item.date || "日期未知"}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside>
            <div className="sectionTitle tight">
              <h2>GitHub 热点</h2>
              <p>{report.githubHot.length} 个</p>
            </div>
            <div className="itemStack">
              {report.githubHot.map((repo, index) => (
                <article className="repoCard" key={`${repo.url || repo.name}-${index}`}>
                  <span className="index">{String(index + 1).padStart(2, "0")}</span>
                  <h3>
                    {repo.url ? (
                      <a href={repo.url} {...externalLinkProps}>
                        {repo.name}
                      </a>
                    ) : (
                      repo.name
                    )}
                  </h3>
                  <p>{repo.chineseMeaning || repo.description || "暂无简介"}</p>
                  {repo.description ? <small>原文：{repo.description}</small> : null}
                  <div className="metaLine">
                    {repo.language ? <span>{repo.language}</span> : null}
                    {repo.stars ? <span>Stars {repo.stars}</span> : null}
                    {repo.starsToday ? <span>Today +{repo.starsToday}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
