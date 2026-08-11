import fs from 'node:fs/promises';
import path from 'node:path';

const TIMEZONE = 'Asia/Shanghai';
const TIMEZONE_LABEL = '北京时间 UTC+8';
const OUTPUT_DIR = process.env.DAILY_TECH_OUTPUT_DIR || 'daily-tech';
const FEISHU_WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL || '';
const SEND_FEISHU = String(process.env.SEND_FEISHU || 'true').toLowerCase() !== 'false';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const MAX_NEWS = numberEnv('MAX_NEWS', 10);
const MAX_GITHUB = numberEnv('MAX_GITHUB', 5);
const MAX_BUILDERS = numberEnv('MAX_BUILDERS', 5);
const MAX_DEMANDS = numberEnv('MAX_DEMANDS', 5);

const warnings = [];

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function shanghaiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function shanghaiDateKey(date = new Date()) {
  const parts = shanghaiDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shanghaiDateTime(date = new Date()) {
  const parts = shanghaiDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function dateKeyFrom(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return shanghaiDateKey(date);
}

function decodeHtml(input = '') {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '-',
    mdash: '-',
  };

  return String(input)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (_, n) => named[n.toLowerCase()] || `&${n};`);
}

function clean(input = '') {
  return decodeHtml(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(input = '', length = 140) {
  const value = clean(input);
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1).trim()}...`;
}

function markdownLink(text, href) {
  const label = clean(text).replace(/\]/g, '\\]');
  return href ? `[${label}](${href})` : label;
}

function escapeLarkMd(input = '') {
  return clean(input)
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, "'");
}

function larkLink(text, href) {
  const label = escapeLarkMd(truncate(text, 64)) || '打开链接';
  return href ? `[${label}](${href})` : label;
}

function hasChinese(input = '') {
  return /[\u4e00-\u9fff]/.test(String(input));
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = String(keyFn(item) || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 30000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'daily-tech-archive-github-action/1.0',
        Accept: options.accept || '*/*',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${truncate(text, 160)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    accept: options.accept || 'application/json',
  });
  return JSON.parse(text);
}

async function source(label, task, fallback = []) {
  try {
    return await task();
  } catch (error) {
    warnings.push(`${label} -> ${error.message || String(error)}`);
    return fallback;
  }
}

function extractTag(block, tag) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'i');
  const match = block.match(pattern);
  return match ? clean(match[1]) : '';
}

function extractLink(block) {
  const direct = extractTag(block, 'link');
  if (direct) return direct;
  const href = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  return href ? decodeHtml(href[1]).trim() : '';
}

function parseFeed(xml, sourceName) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks
    .map((block) => {
      const publishedRaw =
        extractTag(block, 'pubDate') ||
        extractTag(block, 'published') ||
        extractTag(block, 'updated') ||
        extractTag(block, 'dc:date');

      return {
        title: extractTag(block, 'title'),
        link: extractLink(block),
        summary: truncate(extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content'), 180),
        publishedRaw,
        date: dateKeyFrom(publishedRaw),
        source: sourceName,
      };
    })
    .filter((item) => item.title && item.link);
}

async function collectNews(today) {
  const rssSources = [
    ['IT之家 RSS', 'https://www.ithome.com/rss/'],
    ['GitHub Blog', 'https://github.blog/feed/'],
  ];

  let candidates = [];
  for (const [label, url] of rssSources) {
    const items = await source(label, async () => parseFeed(await fetchText(url, { accept: 'application/rss+xml, application/xml, text/xml' }), label));
    candidates = candidates.concat(items);
  }

  const hnFrontPage = await source('Hacker News front page', async () => {
    const data = await fetchJson('https://hn.algolia.com/api/v1/search?tags=front_page');
    return (data.hits || []).map((hit) => ({
      title: hit.title || hit.story_title || '',
      link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      summary: `${hit.points || 0} points · ${hit.num_comments || 0} comments`,
      publishedRaw: hit.created_at || '',
      date: dateKeyFrom(hit.created_at),
      source: 'Hacker News',
    })).filter((item) => item.title && item.link);
  });
  candidates = candidates.concat(hnFrontPage);

  candidates = uniqueBy(candidates, (item) => item.link || item.title);
  const todayFirst = candidates.filter((item) => item.date === today);
  return uniqueBy(todayFirst.concat(candidates), (item) => item.title).slice(0, MAX_NEWS);
}

function cleanRepoDescription(input = '', repoName = '') {
  let value = clean(input)
    .replace(/^(?:Sponsor\s+)?Star\s+/i, '')
    .replace(/^Sponsor\s+/i, '')
    .trim();
  if (repoName) {
    const escaped = repoName.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&').replace('/', '\\s*/\\s*');
    value = value.replace(new RegExp(`^${escaped}\\s+`, 'i'), '').trim();
  }
  return value.replace(/^\s*[-:|]\s*/, '').replace(/\s+/g, ' ').trim();
}

function parseGithubTrending(html) {
  const articles = html.match(/<article\b[\s\S]*?<\/article>/gi) || [];
  return articles
    .map((article) => {
      const pathMatch = article.match(/<h2[\s\S]*?<a[^>]+href=["']\/([^"']+)["'][\s\S]*?<\/a>/i);
      const repoPath = pathMatch ? clean(pathMatch[1]).replace(/\s+/g, '') : '';
      if (!repoPath || !repoPath.includes('/')) return null;

      const descriptionMatch = article.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const languageMatch = article.match(/itemprop=["']programmingLanguage["'][^>]*>([\s\S]*?)<\/span>/i);
      const starsTodayMatch = article.match(/([\d,]+)\s+stars?\s+today/i);
      const totalStarsMatch = article.match(/href=["']\/[^"']+\/stargazers["'][\s\S]*?>([\s\S]*?)<\/a>/i);

      return {
        name: repoPath,
        url: `https://github.com/${repoPath}`,
        description: descriptionMatch ? truncate(cleanRepoDescription(descriptionMatch[1], repoPath), 150) : '',
        language: languageMatch ? clean(languageMatch[1]) : '',
        stars: totalStarsMatch ? clean(totalStarsMatch[1]).replace(/\s+/g, ' ') : '',
        starsToday: starsTodayMatch ? starsTodayMatch[1].replace(/,/g, '') : '',
        source: 'GitHub Trending',
      };
    })
    .filter(Boolean);
}

function repoChineseMeaning(repo) {
  const description = clean(repo.description || '');
  if (hasChinese(description)) return truncate(description, 110);

  const text = [repo.name, repo.description, repo.language].join(' ').toLowerCase();
  const tags = [];
  const add = (pattern, label) => {
    if (pattern.test(text) && !tags.includes(label)) tags.push(label);
  };

  add(/\b(ai|llm|large language|openai|chatgpt|claude|gemini|prompt|rag|agent|model|inference)\b/, 'AI / 大模型');
  add(/\b(image|video|audio|voice|speech|tts|vision|multimodal|diffusion)\b/, '多媒体生成与处理');
  add(/\b(web|browser|html|css|react|vue|next\.?js|frontend|ui|dashboard)\b/, '网页 / 前端体验');
  add(/\b(api|sdk|framework|library|toolkit|package|server|backend|service)\b/, '开发框架或工具库');
  add(/\b(cli|terminal|shell|command line|developer tool|devtool)\b/, '命令行与开发者工具');
  add(/\b(automation|workflow|orchestration|pipeline|scheduler)\b/, '自动化工作流');
  add(/\b(security|privacy|auth|encrypt|scan|vulnerability)\b/, '安全与隐私');
  add(/\b(kubernetes|docker|container|deploy|cloud|infra|observability|monitoring)\b/, '云原生 / 运维基础设施');
  add(/\b(database|postgres|mysql|sqlite|redis|vector|search|index|storage)\b/, '数据存储与检索');

  const language = repo.language ? `${repo.language} 项目` : '开源项目';
  if (tags.length > 0) return `${language}，主要方向：${tags.slice(0, 3).join('、')}。`;
  if (description) return `${language}，可理解为：围绕“${truncate(description, 54)}”的开源项目。`;
  return `${language}，用途需要打开仓库进一步查看。`;
}

async function githubSearchRepositories(query, label) {
  const params = new URLSearchParams({
    q: query,
    sort: 'stars',
    order: 'desc',
    per_page: '10',
  });

  const headers = {
    Accept: 'application/vnd.github+json, application/json',
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const data = await fetchJson(`https://api.github.com/search/repositories?${params}`, { headers });
  return (data.items || []).map((repo) => ({
    name: repo.full_name,
    url: repo.html_url,
    description: truncate(cleanRepoDescription(repo.description || '', repo.full_name), 150),
    language: repo.language || '',
    stars: String(repo.stargazers_count || 0),
    starsToday: '',
    source: label,
  }));
}

async function collectGithubHot(today) {
  let candidates = await source('GitHub Trending', async () => parseGithubTrending(await fetchText('https://github.com/trending?since=daily', { accept: 'text/html' })));
  candidates = candidates.concat(await source('GitHub Search created today', () => githubSearchRepositories(`created:>=${today}`, 'GitHub Search: created today')));
  candidates = candidates.concat(await source('GitHub Search pushed today', () => githubSearchRepositories(`pushed:>=${today} stars:>1000`, 'GitHub Search: pushed today')));

  const result = uniqueBy(candidates, (repo) => repo.name).slice(0, MAX_GITHUB);
  result.forEach((repo) => {
    repo.chineseMeaning = repoChineseMeaning(repo);
  });
  return result;
}

function firstString(record, fields) {
  for (const field of fields) {
    const value = record && record[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function collectObjects(value, output = [], seen = new Set()) {
  if (!value || output.length > 500) return output;
  if (typeof value !== 'object') return output;
  if (seen.has(value)) return output;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => collectObjects(entry, output, seen));
    return output;
  }

  const title = firstString(value, ['title', 'name', 'text', 'content', 'summary']);
  const link = firstString(value, ['url', 'link', 'href', 'source_url', 'sourceUrl', 'external_url']);
  if (title || link) output.push(value);

  Object.values(value).forEach((entry) => collectObjects(entry, output, seen));
  return output;
}

async function collectBuilderSignals() {
  const feeds = [
    ['X', 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json'],
    ['Blog', 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json'],
    ['Podcast', 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json'],
  ];

  let candidates = [];
  for (const [kind, url] of feeds) {
    const items = await source(`follow-builders ${kind}`, async () => {
      const data = await fetchJson(url);
      return collectObjects(data).map((record) => {
        const title = firstString(record, ['title', 'name', 'text', 'content', 'summary']);
        const summary = firstString(record, ['summary', 'description', 'text', 'content', 'body']);
        const link = firstString(record, ['url', 'link', 'href', 'source_url', 'sourceUrl', 'external_url']);
        const author = firstString(record, ['author', 'creator', 'username', 'handle', 'source', 'site']);
        const publishedRaw = firstString(record, ['published_at', 'publishedAt', 'published', 'created_at', 'createdAt', 'date', 'updated_at']);
        return {
          title: truncate(title || summary, 90),
          summary: truncate(summary, 150),
          author,
          link,
          publishedRaw,
          date: dateKeyFrom(publishedRaw),
          source: `follow-builders ${kind}`,
        };
      }).filter((item) => item.title && item.link);
    });
    candidates = candidates.concat(items);
  }

  return uniqueBy(candidates, (item) => item.link || item.title).slice(0, MAX_BUILDERS);
}

function demandType(text) {
  const value = text.toLowerCase();
  if (/替代|alternative|instead of|replace/.test(value)) return '替代方案';
  if (/推荐|recommend|best|which/.test(value)) return '工具选型';
  if (/怎么|如何|how to|is there a way/.test(value)) return '操作难题';
  if (/自动|automation|workflow|script|bot/.test(value)) return '自动化需求';
  if (/贵|price|pricing|cost|expensive|cheap/.test(value)) return '价格敏感';
  if (/bug|error|failed|broken|issue/.test(value)) return '产品缺陷';
  return '潜在需求';
}

function opportunityFrom(text) {
  const type = demandType(text);
  const mapping = {
    替代方案: '整理竞品替代表、做迁移工具或对比页。',
    工具选型: '做细分场景榜单、决策助手或模板库。',
    操作难题: '做一键化工具、教程产品或自动化脚本。',
    自动化需求: '把重复流程封装成工作流、浏览器插件或轻量 SaaS。',
    价格敏感: '做低价替代、开源版本或按量付费方案。',
    产品缺陷: '针对高频缺陷做修复型小工具或兼容层。',
    潜在需求: '继续观察同类问题频次，寻找可产品化入口。',
  };
  return mapping[type];
}

function isLowQualityDemand(item) {
  const text = `${item.title || ''} ${item.summary || ''}`;
  if (/V2EX/.test(item.source || '') && /推广|开户|抽奖|低佣|证券|ETF|股票|返佣/.test(text)) return true;
  if (/^feature request$/i.test(clean(item.title || '')) && clean(item.summary || '').length < 40) return true;
  if (/comment-auto-bot|test feature|please add this feature/i.test(`${item.source || ''} ${text}`)) return true;
  return false;
}

function scoreDemand(item) {
  const text = `${item.title} ${item.summary || ''}`;
  let score = 35;
  if (/求|推荐|有没有|怎么|如何|太难用|替代|需求|想做/.test(text)) score += 25;
  if (/\b(recommend|alternative|tool|how to|is there|looking for|pain|problem|manual)\b/i.test(text)) score += 25;
  score += Math.min(25, Math.round(Math.log10(Number(item.points || 0) + Number(item.comments || 0) + 1) * 18));
  return Math.max(1, Math.min(100, score));
}

async function collectDemandSignals(today) {
  let candidates = [];

  const hnAsk = await source('Hacker News Ask HN', async () => {
    const data = await fetchJson('https://hn.algolia.com/api/v1/search_by_date?tags=ask_hn&hitsPerPage=30');
    return (data.hits || []).map((hit) => ({
      title: hit.title || '',
      summary: '',
      link: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      source: 'Hacker News Ask HN',
      publishedRaw: hit.created_at || '',
      date: dateKeyFrom(hit.created_at),
      points: hit.points || 0,
      comments: hit.num_comments || 0,
    }));
  });
  candidates = candidates.concat(hnAsk);

  const githubIssues = await source('GitHub Issues demand search', async () => {
    const query = `"feature request" OR "would be nice" OR "is there a way" is:issue comments:>0 created:>=${today}`;
    const params = new URLSearchParams({
      q: query,
      sort: 'comments',
      order: 'desc',
      per_page: '10',
    });
    const headers = { Accept: 'application/vnd.github+json, application/json' };
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    const data = await fetchJson(`https://api.github.com/search/issues?${params}`, { headers });
    return (data.items || []).map((issue) => ({
      title: issue.title || '',
      summary: truncate(issue.body || '', 160),
      link: issue.html_url,
      source: `GitHub Issue · ${issue.repository_url?.split('/repos/')[1] || ''}`,
      publishedRaw: issue.created_at || '',
      date: dateKeyFrom(issue.created_at),
      points: issue.reactions?.total_count || 0,
      comments: issue.comments || 0,
    }));
  });
  candidates = candidates.concat(githubIssues);

  const v2exHot = await source('V2EX hot topics', async () => {
    const data = await fetchJson('https://www.v2ex.com/api/topics/hot.json');
    return (Array.isArray(data) ? data : []).map((topic) => ({
      title: topic.title || '',
      summary: topic.content_rendered || topic.content || '',
      link: topic.url || `https://www.v2ex.com/t/${topic.id}`,
      source: `V2EX · ${topic.node?.title || topic.node?.name || 'hot'}`,
      publishedRaw: topic.created ? new Date(topic.created * 1000).toISOString() : '',
      date: topic.created ? shanghaiDateKey(new Date(topic.created * 1000)) : '',
      points: 0,
      comments: topic.replies || 0,
    }));
  });
  candidates = candidates.concat(v2exHot);

  const demandPattern = /求|推荐|有没有|怎么|如何|太难用|替代|需求|想做|\b(recommend|alternative|tool|how to|is there|looking for|pain|problem|manual)\b/i;
  candidates = uniqueBy(candidates, (item) => item.link || item.title)
    .filter((item) => !isLowQualityDemand(item))
    .filter((item) => demandPattern.test(`${item.title} ${item.summary || ''}`) || item.source.includes('GitHub Issue'))
    .map((item) => {
      const text = `${item.title} ${item.summary || ''}`;
      const type = demandType(text);
      return {
        ...item,
        summary: truncate(item.summary || '', 140),
        demandType: type,
        opportunity: opportunityFrom(text),
        score: scoreDemand(item),
      };
    })
    .sort((a, b) => b.score - a.score);

  const todayFirst = candidates.filter((item) => item.date === today);
  return uniqueBy(todayFirst.concat(candidates), (item) => item.link || item.title).slice(0, MAX_DEMANDS);
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# 科技日报 · ${report.date}`);
  lines.push('');
  lines.push(`生成时间：${report.generatedAt}（${report.timezoneLabel}）`);
  lines.push('');
  lines.push(`## 科技新闻（${report.news.length} 条）`);
  lines.push('');
  if (report.news.length === 0) lines.push('暂无可用新闻。');
  report.news.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${markdownLink(item.title, item.link)}`);
    lines.push('');
    lines.push(`- 来源：${[item.source, item.date || '日期未知'].filter(Boolean).join(' · ')}`);
    if (item.summary) lines.push(`- 摘要：${truncate(item.summary, 180)}`);
    lines.push('');
  });

  lines.push(`## GitHub 热点（${report.githubHot.length} 个）`);
  lines.push('');
  if (report.githubHot.length === 0) lines.push('暂无可用 GitHub 热点。');
  report.githubHot.forEach((repo, index) => {
    const meta = [repo.language, repo.stars ? `Stars ${repo.stars}` : '', repo.starsToday ? `Today +${repo.starsToday}` : '', repo.source].filter(Boolean).join(' · ');
    lines.push(`### ${index + 1}. ${markdownLink(repo.name, repo.url)}`);
    lines.push('');
    lines.push(`- 元信息：${meta}`);
    if (repo.chineseMeaning) lines.push(`- 中文释义：${repo.chineseMeaning}`);
    if (repo.description) lines.push(`- 原文简介：${truncate(repo.description, 180)}`);
    lines.push('');
  });

  lines.push(`## AI Builders 动态（${report.builderSignals.length} 条）`);
  lines.push('');
  if (report.builderSignals.length === 0) lines.push('暂无可用动态。');
  report.builderSignals.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${markdownLink(item.title, item.link)}`);
    lines.push('');
    lines.push(`- 来源：${[item.source, item.author, item.date || '日期未知'].filter(Boolean).join(' · ')}`);
    if (item.summary) lines.push(`- 摘要：${truncate(item.summary, 180)}`);
    lines.push('');
  });

  lines.push(`## 今日需求雷达（${report.demandSignals.length} 条）`);
  lines.push('');
  if (report.demandSignals.length === 0) lines.push('暂无可用需求信号。');
  report.demandSignals.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${markdownLink(item.title, item.link)}`);
    lines.push('');
    lines.push(`- 需求强度：${item.score}/100`);
    lines.push(`- 痛点类型：${item.demandType}`);
    lines.push(`- 产品机会：${item.opportunity}`);
    lines.push(`- 来源：${[item.source, item.date || '日期未知'].filter(Boolean).join(' · ')}`);
    if (item.summary) lines.push(`- 原文摘要：${truncate(item.summary, 180)}`);
    lines.push('');
  });

  if (report.sourceWarnings.length > 0) {
    lines.push('## 数据源提示');
    lines.push('');
    report.sourceWarnings.forEach((warning) => lines.push(`- ${warning}`));
    lines.push('');
  }

  return lines.join('\n');
}

function cardText(content) {
  return {
    tag: 'div',
    text: {
      tag: 'lark_md',
      content,
    },
  };
}

function cardHeader(title, template = 'blue') {
  return {
    title: {
      tag: 'plain_text',
      content: title,
    },
    template,
  };
}

function buildFeishuCard(report) {
  const nl = '\n';
  const elements = [
    cardText(`**生成时间**：${report.generatedAt}（${report.timezoneLabel}）${nl}**今日概览**：科技新闻 ${report.news.length} 条 · GitHub 热点 ${report.githubHot.length} 个 · AI Builder ${report.builderSignals.length} 条 · 需求雷达 ${report.demandSignals.length} 条`),
    { tag: 'hr' },
    cardText('**科技新闻**'),
  ];

  for (const [index, item] of report.news.entries()) {
    const meta = [item.source, item.date || '日期未知'].filter(Boolean).join(' · ');
    elements.push(cardText(`**${index + 1}. ${larkLink(item.title, item.link)}**${nl}<font color="grey">${escapeLarkMd(meta)}</font>${item.summary ? `${nl}${escapeLarkMd(truncate(item.summary, 96))}` : ''}`));
  }

  elements.push({ tag: 'hr' }, cardText('**GitHub 热点**'));
  for (const [index, repo] of report.githubHot.entries()) {
    const meta = [repo.language, repo.stars ? `Stars ${repo.stars}` : '', repo.starsToday ? `Today +${repo.starsToday}` : '', repo.source].filter(Boolean).join(' · ');
    elements.push(cardText(`**${index + 1}. ${larkLink(repo.name, repo.url)}**${nl}<font color="grey">${escapeLarkMd(meta)}</font>${nl}**中文释义**：${escapeLarkMd(repo.chineseMeaning || repoChineseMeaning(repo))}${repo.description ? `${nl}<font color="grey">原文：${escapeLarkMd(truncate(repo.description, 96))}</font>` : ''}`));
  }

  elements.push({ tag: 'hr' }, cardText('**AI Builders 动态**'));
  if (report.builderSignals.length === 0) {
    elements.push(cardText('<font color="grey">暂无可用动态。</font>'));
  }
  for (const [index, item] of report.builderSignals.entries()) {
    const meta = [item.source, item.author, item.date || '日期未知'].filter(Boolean).join(' · ');
    elements.push(cardText(`**${index + 1}. ${larkLink(item.title, item.link)}**${nl}<font color="grey">${escapeLarkMd(meta)}</font>${item.summary ? `${nl}${escapeLarkMd(truncate(item.summary, 96))}` : ''}`));
  }

  elements.push({ tag: 'hr' }, cardText('**今日需求雷达**'));
  if (report.demandSignals.length === 0) {
    elements.push(cardText('<font color="grey">暂无可用需求信号。</font>'));
  }
  for (const [index, item] of report.demandSignals.entries()) {
    const meta = [item.source, item.date || '日期未知'].filter(Boolean).join(' · ');
    elements.push(cardText(`**${index + 1}. ${larkLink(item.title, item.link)}**${nl}<font color="grey">${escapeLarkMd(meta)} · 强度 ${item.score}/100</font>${nl}**痛点**：${escapeLarkMd(item.demandType)}${nl}**机会**：${escapeLarkMd(item.opportunity)}`));
  }

  elements.push({ tag: 'hr' });
  elements.push(cardText(`**归档保存**${nl}${escapeLarkMd(`${OUTPUT_DIR}/${report.date}.md`)} / ${escapeLarkMd(`${OUTPUT_DIR}/${report.date}.json`)}`));

  if (report.sourceWarnings.length > 0) {
    elements.push(cardText(`**数据源提示**${nl}<font color="grey">${escapeLarkMd(report.sourceWarnings.slice(0, 5).join('；'))}</font>`));
  }

  elements.push({
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: '数据源：IT之家、GitHub Blog、Hacker News、GitHub Trending/Search、follow-builders、V2EX。标题可点击打开原文。',
      },
    ],
  });

  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: cardHeader(`科技日报 · ${report.date}`),
      elements,
    },
  };
}

async function sendFeishu(report) {
  if (!SEND_FEISHU) {
    console.log('SEND_FEISHU=false, skipped Feishu delivery.');
    return;
  }
  if (!FEISHU_WEBHOOK_URL) {
    console.log('FEISHU_WEBHOOK_URL is empty, skipped Feishu delivery.');
    return;
  }

  const response = await fetch(FEISHU_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildFeishuCard(report)),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Feishu webhook failed: ${response.status} ${response.statusText}: ${truncate(text, 180)}`);

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (data.code && data.code !== 0) {
    throw new Error(`Feishu webhook returned code ${data.code}: ${data.msg || text}`);
  }
  console.log('Feishu delivery succeeded.');
}

async function main() {
  const date = shanghaiDateKey();
  const generatedAt = shanghaiDateTime();

  const [news, githubHot, builderSignals, demandSignals] = await Promise.all([
    collectNews(date),
    collectGithubHot(date),
    collectBuilderSignals(),
    collectDemandSignals(date),
  ]);

  const report = {
    date,
    generatedAt,
    timezone: TIMEZONE,
    timezoneLabel: TIMEZONE_LABEL,
    newsCount: news.length,
    githubCount: githubHot.length,
    builderSignalCount: builderSignals.length,
    demandSignalCount: demandSignals.length,
    news,
    githubHot,
    builderSignals,
    demandSignals,
    sourceWarnings: warnings,
  };

  const markdown = buildMarkdown(report);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, `${date}.md`), markdown, 'utf8');
  await fs.writeFile(path.join(OUTPUT_DIR, `${date}.json`), `${JSON.stringify({ ...report, markdown }, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${OUTPUT_DIR}/${date}.md and ${OUTPUT_DIR}/${date}.json`);
  if (warnings.length > 0) {
    console.log(`Source warnings: ${warnings.length}`);
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  await sendFeishu(report);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
