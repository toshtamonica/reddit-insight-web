const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { marked } = require('marked');

// 配置
const TRANSLATIONS_DIR = process.env.TRANSLATIONS_DIR || '../reddit-insight/translations';
const OUTPUT_DIR = './dist';

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Markdown 转换
function mdToHtml(text) {
  if (!text) return '';
  return marked.parse(text);
}

// 提取简洁标题
function extractTitle(titleZh) {
  if (!titleZh) return '';
  
  // 如果标题包含 "以下是" 或 "几种翻译" 等说明性文字，提取第一个实际翻译
  if (titleZh.includes('以下是') || titleZh.includes('翻译方式') || titleZh.includes('**口语化') || titleZh.includes('**简洁') || titleZh.includes('**')) {
    // 尝试提取第一个 - 开头的列表项（多行匹配）
    const listMatch = titleZh.match(/^\s*-\s*(.+)$/m);
    if (listMatch) return listMatch[1].trim();
    
    // 尝试提取第一个 > 引用的内容
    const match = titleZh.match(/\>\s*([^\n]+)/);
    if (match) return match[1].trim();
    
    // 尝试提取 --- 之后的第一行非空内容
    const parts = titleZh.split(/\s*---\s*/);
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i++) {
        const lines = parts[i].split('\n').filter(l => {
          const trimmed = l.trim();
          return trimmed && 
                 !trimmed.includes('**') && 
                 !trimmed.includes('说明') &&
                 !trimmed.includes('：') &&
                 !trimmed.startsWith('#') &&
                 trimmed.length > 5;
        });
        if (lines.length > 0) return lines[0].replace(/\*\*/g, '').replace(/\>/g, '').trim();
      }
    }
    
    // 如果都失败了，取第一行非空且长度适中的内容
    const lines = titleZh.split('\n').filter(l => {
      const trimmed = l.trim();
      return trimmed && 
             !trimmed.includes('翻译') &&
             !trimmed.includes('以下') &&
             trimmed.length > 5 &&
             trimmed.length < 100;
    });
    if (lines.length > 0) return lines[0].replace(/\*\*/g, '').trim();
  }
  
  // 默认情况：按 --- 分割取第一部分，并去除首尾空白和引号
  return titleZh.split(/\s*---\s*/)[0].trim().replace(/^["']|["']$/g, '');
}

// 读取所有帖子
function loadAllPosts() {
  const posts = [];
  const today = new Date().toISOString().split('T')[0];
  
  const files = fs.readdirSync(TRANSLATIONS_DIR).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(TRANSLATIONS_DIR, file), 'utf8'));
      if (data.title_zh) {
        data.display_title = extractTitle(data.title_zh);
      }
      if (data.summary_zh) {
        data.summary_html = mdToHtml(data.summary_zh);
      }
      if (data.translation?.post_body_zh) {
        data.body_html = mdToHtml(data.translation.post_body_zh);
      }
      if (data.translation?.op_replies_zh?.length > 0) {
        data.op_replies_html = data.translation.op_replies_zh.map(r => ({
          index: r.index,
          content_html: mdToHtml(r.content_zh || r.content)
        }));
      }
      const postDate = new Date(data.translated_at).toISOString().split('T')[0];
      data.is_today = (postDate === today);
      data.post_date = postDate;
      posts.push(data);
    } catch (e) {
      console.error(`跳过损坏文件: ${file}`);
    }
  }
  
  return posts.sort((a, b) => new Date(b.translated_at) - new Date(a.translated_at));
}

// 按日期分组
function groupByDate(posts) {
  const groups = {};
  posts.forEach(post => {
    if (!groups[post.post_date]) groups[post.post_date] = [];
    groups[post.post_date].push(post);
  });
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
}

// 生成首页
function generateIndex(posts) {
  const today = new Date().toISOString().split('T')[0];
  const groupedPosts = groupByDate(posts);
  const total = posts.length;
  
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reddit Insight - 每日精选</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; font-size: 14px; }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 15px; }
    .header { background: #2d3748; padding: 15px 0; border-bottom: 3px solid #4a5568; }
    .header h1 { font-size: 1.8em; font-weight: 700; color: #fff; margin: 0; }
    .subtitle { color: #a0aec0; font-size: 0.9em; margin-top: 5px; }
    .stats-bar { background: #fff; padding: 10px 0; border-bottom: 1px solid #e2e8f0; margin-bottom: 15px; }
    .stats { display: flex; gap: 20px; font-size: 0.9em; color: #4a5568; }
    .stat-item strong { color: #2d3748; }
    .badge-new { background: #e53e3e; color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 0.75em; font-weight: 700; }
    .bbs-table { width: 100%; background: #fff; border: 1px solid #e2e8f0; border-radius: 4px; overflow: hidden; margin-bottom: 20px; }
    .table-header { background: #edf2f7; padding: 12px 15px; font-weight: 700; color: #2d3748; border-bottom: 2px solid #cbd5e0; display: flex; justify-content: space-between; align-items: center; }
    .today-label { background: #48bb78; color: #fff; padding: 3px 10px; border-radius: 3px; font-size: 0.8em; }
    .post-list { list-style: none; }
    .post-item { padding: 15px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: flex-start; gap: 15px; }
    .post-item:hover { background: #f7fafc; }
    .post-item:last-child { border-bottom: none; }
    .post-icon { width: 40px; height: 40px; background: #4299e1; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 1.2em; flex-shrink: 0; }
    .post-icon.new { background: #48bb78; }
    .post-content { flex: 1; min-width: 0; }
    .post-title { font-size: 1.05em; font-weight: 600; margin-bottom: 6px; }
    .post-title a { color: #2b6cb0; text-decoration: none; }
    .post-title a:hover { color: #2c5282; text-decoration: underline; }
    .new-tag { display: inline-block; background: #48bb78; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 0.7em; font-weight: 700; margin-left: 8px; }
    .post-meta { color: #718096; font-size: 0.85em; display: flex; gap: 15px; }
    .post-actions { display: flex; gap: 8px; flex-shrink: 0; }
    .btn { padding: 6px 14px; border-radius: 4px; text-decoration: none; font-size: 0.85em; font-weight: 500; }
    .btn-primary { background: #4299e1; color: #fff; }
    .btn-primary:hover { background: #3182ce; }
    .btn-outline { background: #fff; color: #4a5568; border: 1px solid #cbd5e0; }
    .footer { background: #2d3748; color: #a0aec0; text-align: center; padding: 20px; margin-top: 30px; font-size: 0.85em; }
    @media (max-width: 768px) { .post-item { flex-direction: column; } .post-actions { width: 100%; justify-content: flex-end; } }
  </style>
</head>
<body>
  <header class="header">
    <div class="container">
      <h1>📋 Reddit Insight</h1>
      <p class="subtitle">OpenClaw 社区每日精选</p>
    </div>
  </header>
  
  <div class="stats-bar">
    <div class="container">
      <div class="stats">
        <span class="stat-item">📊 主题: <strong>${total}</strong></span>
        <span class="stat-item">🔥 今日: <strong>${groupedPosts.find(([date]) => date === today)?.[1].length || 0}</strong></span>
      </div>
    </div>
  </div>

  <div class="container">
    ${groupedPosts.map(([date, posts]) => `
    <div class="bbs-table">
      <div class="table-header">
        <span>📅 ${date}</span>
        ${date === today ? '<span class="today-label">今日更新</span>' : ''}
      </div>
      <ul class="post-list">
        ${posts.map(post => `
        <li class="post-item">
          <div class="post-icon ${post.is_today ? 'new' : ''}">${post.is_today ? '🔥' : '📄'}</div>
          <div class="post-content">
            <div class="post-title">
              <a href="post/${post.id}.html">${post.display_title || post.title}</a>
              ${post.is_today ? '<span class="new-tag">NEW</span>' : ''}
            </div>
            <div class="post-meta">
              <span>👤 ${post.author}</span>
              <span>📅 ${new Date(post.translated_at).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
          <div class="post-actions">
            <a href="post/${post.id}.html" class="btn btn-primary">阅读</a>
          </div>
        </li>
        `).join('')}
      </ul>
    </div>
    `).join('')}
  </div>
  
  <footer class="footer">
    <p>© 2026 Reddit Insight | 自动抓取翻译</p>
  </footer>
</body>
</html>`;
  
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html);
  console.log('✅ 生成首页: index.html');
}

// 生成详情页
function generatePostPages(posts) {
  const postsDir = path.join(OUTPUT_DIR, 'post');
  if (!fs.existsSync(postsDir)) {
    fs.mkdirSync(postsDir, { recursive: true });
  }
  
  for (const post of posts) {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${post.display_title || post.title} - Reddit Insight</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; font-size: 14px; }
    .container { max-width: 1000px; margin: 0 auto; padding: 0 15px; }
    .header { background: #2d3748; padding: 15px 0; border-bottom: 3px solid #4a5568; }
    .header h1 { font-size: 1.8em; font-weight: 700; color: #fff; margin: 0; }
    .subtitle { color: #a0aec0; font-size: 0.9em; margin-top: 5px; }
    .post-detail { background: #fff; border: 1px solid #e2e8f0; border-radius: 4px; margin: 20px 0; }
    .post-header { background: #edf2f7; padding: 20px; border-bottom: 1px solid #e2e8f0; }
    .post-header h1 { font-size: 1.4em; font-weight: 700; color: #2d3748; margin-bottom: 10px; }
    .post-meta { color: #718096; font-size: 0.9em; }
    .post-body { padding: 25px; }
    .post-section { margin-bottom: 30px; }
    .post-section h2 { font-size: 1.1em; font-weight: 700; color: #2d3748; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
    .summary-box { background: #f7fafc; border-left: 4px solid #4299e1; padding: 20px; border-radius: 0 4px 4px 0; }
    .content-box { background: #fff; border: 1px solid #e2e8f0; padding: 20px; border-radius: 4px; line-height: 1.9; }
    .replies-section { margin-top: 30px; }
    .reply-item { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 15px; margin-bottom: 15px; }
    .reply-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; }
    .reply-num { background: #4299e1; color: #fff; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85em; }
    .links-box { background: #f7fafc; padding: 15px 20px; border-top: 1px solid #e2e8f0; }
    .links-box a { color: #4299e1; text-decoration: none; }
    .post-footer-bar { background: #edf2f7; padding: 15px 20px; border-top: 1px solid #e2e8f0; display: flex; gap: 10px; }
    .btn { padding: 8px 16px; border-radius: 4px; text-decoration: none; font-size: 0.9em; font-weight: 500; display: inline-block; }
    .btn-primary { background: #4299e1; color: #fff; }
    .btn-outline { background: #fff; color: #4a5568; border: 1px solid #cbd5e0; }
    .footer { background: #2d3748; color: #a0aec0; text-align: center; padding: 20px; margin-top: 30px; font-size: 0.85em; }
  </style>
</head>
<body>
  <header class="header">
    <div class="container">
      <h1>📋 Reddit Insight</h1>
      <p class="subtitle">OpenClaw 社区每日精选</p>
    </div>
  </header>
  
  <div class="container">
    <article class="post-detail">
      <header class="post-header">
        <h1>${post.display_title || post.title}</h1>
        <div class="post-meta">
          <span>👤 ${post.author}</span> | <span>📅 ${new Date(post.translated_at).toLocaleDateString('zh-CN')}</span>
        </div>
      </header>
      
      <div class="post-body">
        ${post.summary_html ? `
        <section class="post-section">
          <h2>📋 内容摘要</h2>
          <div class="summary-box">${post.summary_html}</div>
        </section>
        ` : ''}
        
        ${post.body_html ? `
        <section class="post-section">
          <h2>📝 正文翻译</h2>
          <div class="content-box">${post.body_html}</div>
        </section>
        ` : ''}
        
        ${post.op_replies_html?.length ? `
        <section class="post-section replies-section">
          <h2>💬 OP 回复译文 (${post.op_replies_html.length} 条)</h2>
          ${post.op_replies_html.map(r => `
          <div class="reply-item">
            <div class="reply-header">
              <span class="reply-num">${r.index}</span>
              <span>楼主回复</span>
            </div>
            <div class="reply-content">${r.content_html}</div>
          </div>
          `).join('')}
        </section>
        ` : ''}
      </div>
      
      <div class="links-box">
        🔗 <a href="${post.reddit_url}" target="_blank">查看 Reddit 原文</a>
      </div>
      
      <div class="post-footer-bar">
        <a href="/" class="btn btn-primary">← 返回列表</a>
      </div>
    </article>
  </div>
  
  <footer class="footer">
    <p>© 2026 Reddit Insight | 自动抓取翻译</p>
  </footer>
</body>
</html>`;
    
    fs.writeFileSync(path.join(postsDir, `${post.id}.html`), html);
  }
  
  console.log(`✅ 生成 ${posts.length} 个详情页`);
}

// 主函数
console.log('🚀 开始生成静态页面...\n');
const posts = loadAllPosts();
console.log(`📊 加载了 ${posts.length} 篇帖子\n`);
generateIndex(posts);
generatePostPages(posts);
console.log('\n✅ 所有页面生成完成！输出目录: ./dist');
