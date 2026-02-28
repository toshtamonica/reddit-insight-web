#!/usr/bin/env node
/**
 * 翻译器
 * 翻译帖子标题、正文和OP回复
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const KIMI_API_KEY = process.env.MOONSHOT_API_KEY || 'sk-kimi-WtgHC0JBY0RWKJBUjgUJ4ghTHX6PCStFhbUSzZal4v482nql6GqC5Vi7jo5uoOVc';
const KIMI_API_URL = 'https://api.kimi.com/coding/v1/messages';

class Translator {
  constructor(options = {}) {
    this.config = options.config || {};
    this.dataDir = options.dataDir || path.join(__dirname, '../data');
    this.translationsDir = options.translationsDir || path.join(__dirname, '../translations');
    this.translatedIds = new Set(); // 已翻译的帖子ID
    
    if (!fs.existsSync(this.translationsDir)) {
      fs.mkdirSync(this.translationsDir, { recursive: true });
    }
    
    // 加载已翻译的帖子ID
    this.loadTranslatedIds();
  }
  
  /**
   * 加载已翻译的帖子ID
   */
  loadTranslatedIds() {
    try {
      const indexPath = path.join(this.translationsDir, '_index.json');
      if (fs.existsSync(indexPath)) {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        if (index.posts) {
          index.posts.forEach(p => this.translatedIds.add(p.id));
          console.log(`📚 已加载 ${this.translatedIds.size} 个已翻译帖子ID`);
        }
      }
    } catch (e) {
      console.log('ℹ️ 没有翻译索引，将翻译全部帖子');
    }
  }
  
  /**
   * 检查帖子是否已翻译
   */
  isTranslated(postId) {
    return this.translatedIds.has(postId);
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清理和提取标题
   * 处理 LLM 可能返回的多版本格式
   */
  cleanTitle(titleZh) {
    if (!titleZh) return '';
    
    // 如果包含"以下是"或"几种翻译"等说明性文字，提取第一个实际翻译
    if (titleZh.includes('以下是') || titleZh.includes('翻译方式') || titleZh.includes('**')) {
      // 尝试提取第一个 - 开头的列表项（多行匹配）
      const listMatch = titleZh.match(/^\s*-\s*(.+)$/m);
      if (listMatch) return listMatch[1].trim();
      
      // 尝试提取第一个 > 引用的内容
      const quoteMatch = titleZh.match(/\>\s*([^\n]+)/);
      if (quoteMatch) return quoteMatch[1].trim();
      
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
          if (lines.length > 0) {
            return lines[0].replace(/\*\*/g, '').replace(/\>/g, '').trim();
          }
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
    
    // 默认情况：去除首尾空白和引号
    return titleZh.trim().replace(/^["']|["']$/g, '');
  }

  /**
   * 调用LLM翻译
   */
  async translateWithKimi(text, type = 'content') {
    if (!text || text.trim().length === 0) return '';

    const prompts = {
      title: `你是一位专业的中英翻译专家，专注于翻译 Reddit OpenClaw 社区的帖子标题。

要求：
1. 只输出一个最简洁、最自然的翻译结果
2. 不要提供多个版本、选项或解释
3. 不要添加"以下是翻译"等说明文字
4. 直接输出翻译后的标题，不要加引号
5. 保持原意的同时，让中文读者一眼就能理解
6. 如果涉及技术术语，请使用中文技术圈常用表达

请翻译以下标题：`,
      content: `将以下内容翻译成流畅自然的中文，保持原意：

要求：
1. 直接输出翻译结果，不要添加说明
2. 保持原文的语气和风格
3. 技术术语使用中文技术圈常用表达

内容：`,
      summary: `用中文总结以下内容的3-5个核心要点：

要求：
1. 使用简洁的 bullet points
2. 每个要点一行
3. 直接输出总结，不要添加说明

内容：`
    };

    const prompt = `${prompts[type]}\n\n${text.substring(0, 3000)}`;

    const tmpFile = `/tmp/translate_${Date.now()}_${Math.random().toString(36).slice(2)}.json`;
    fs.writeFileSync(tmpFile, JSON.stringify({
      model: "kimi-for-coding",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    }));

    const curlCmd = `curl -s -X POST "${KIMI_API_URL}" \
      -H "x-api-key: ${KIMI_API_KEY}" \
      -H "anthropic-version: 2023-06-01" \
      -H "Content-Type: application/json" \
      -H "User-Agent: Claude Code/1.0.0" \
      -d @${tmpFile} 2>/dev/null`;

    try {
      const { stdout } = await execAsync(curlCmd, { timeout: 120000 });
      try { fs.unlinkSync(tmpFile); } catch (e) {}

      let response;
      try {
        response = JSON.parse(stdout);
      } catch (parseErr) {
        return '翻译失败：API响应格式错误';
      }

      if (response.content && response.content[0] && response.content[0].text) {
        return response.content[0].text.trim();
      }
      return '翻译失败：无内容返回';
    } catch (err) {
      try { fs.unlinkSync(tmpFile); } catch (e) {}
      console.error('翻译失败:', err.message);
      return `翻译失败: ${err.message}`;
    }
  }

  /**
   * 翻译单个帖子
   */
  async translatePost(postDetail) {
    const { post, authorReplies = [] } = postDetail;
    
    console.log(`  📝 翻译: ${post.title.substring(0, 50)}...`);

    // 翻译标题
    const rawTitleZh = await this.translateWithKimi(post.title, 'title');
    const titleZh = this.cleanTitle(rawTitleZh);  // 清理标题格式
    await this.delay(500);

    // 翻译正文
    const bodyZh = post.body 
      ? await this.translateWithKimi(post.body, 'content')
      : '';
    await this.delay(500);

    // 翻译OP回复
    const repliesZh = [];
    for (const reply of authorReplies.slice(0, 10)) { // 最多翻译10条回复
      const contentZh = await this.translateWithKimi(reply.content, 'content');
      repliesZh.push({
        index: reply.index,
        content_zh: contentZh,
        score: reply.score,
        depth: reply.depth
      });
      await this.delay(300);
    }

    // 生成摘要
    const fullContent = `${post.title}\n\n${post.body}\n\n` + 
      authorReplies.map(r => r.content).join('\n\n');
    const summaryZh = await this.translateWithKimi(fullContent.substring(0, 2000), 'summary');

    return {
      id: post.id || this.extractIdFromUrl(post.url),
      title: post.title,
      title_zh: titleZh,
      author: post.author,
      reddit_url: post.url,
      created: post.created,
      original: {
        post_body: post.body,
        op_replies: authorReplies.map(r => ({
          index: r.index,
          content: r.content,
          score: r.score,
          depth: r.depth
        }))
      },
      translation: {
        post_body_zh: bodyZh,
        op_replies_zh: repliesZh
      },
      summary_zh: summaryZh,
      translated_at: new Date().toISOString()
    };
  }

  extractIdFromUrl(url) {
    const match = url.match(/comments\/(\w+)/);
    return match ? match[1] : 'unknown';
  }

  /**
   * 批量翻译（支持跳过已翻译）
   */
  async translatePosts(postDetails, onProgress = null) {
    const results = [];
    let skippedCount = 0;
    
    for (let i = 0; i < postDetails.length; i++) {
      const postId = postDetails[i].post?.id || postDetails[i].id;
      
      console.log(`\n[${i + 1}/${postDetails.length}]`);
      
      // 检查是否已翻译
      if (this.isTranslated(postId)) {
        console.log(`  ⏭️  跳过已翻译: ${postDetails[i].post?.title?.substring(0, 50) || postId}...`);
        skippedCount++;
        continue;
      }
      
      try {
        const translated = await this.translatePost(postDetails[i]);
        results.push(translated);
        this.translatedIds.add(postId); // 记录为已翻译
        
        // 保存单个翻译
        this.saveTranslation(translated);
        
        if (onProgress) onProgress(i + 1, postDetails.length, translated);
        
      } catch (err) {
        console.error(`  ❌ 翻译失败: ${err.message}`);
      }
    }

    console.log(`\n📊 翻译统计: 新翻译 ${results.length}, 跳过已翻译 ${skippedCount}`);
    return results;
  }

  /**
   * 保存单个翻译
   */
  saveTranslation(translated) {
    const filename = `${translated.id}_${this.sanitizeFilename(translated.title)}.json`;
    const filepath = path.join(this.translationsDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(translated, null, 2));
    console.log(`  💾 已保存: ${filepath}`);
    return filepath;
  }

  sanitizeFilename(title) {
    return title
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')
      .substring(0, 50);
  }

  /**
   * 生成翻译索引
   */
  generateIndex(translations) {
    const index = {
      generated_at: new Date().toISOString(),
      total: translations.length,
      posts: translations.map(t => ({
        id: t.id,
        title: t.title,
        title_zh: t.title_zh,
        author: t.author,
        reddit_url: t.reddit_url,
        translated_at: t.translated_at,
        file: `${t.id}_${this.sanitizeFilename(t.title)}.json`
      }))
    };

    const indexPath = path.join(this.translationsDir, '_index.json');
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    console.log(`\n📋 索引已保存: ${indexPath}`);
    return indexPath;
  }
}

// 导出
module.exports = { Translator };

// 命令行使用
if (require.main === module) {
  const { RedditFetcher } = require('./fetch-posts.js');

  (async () => {
    const dataDir = path.join(__dirname, '../data');
    const translationsDir = path.join(__dirname, '../translations');

    // 加载筛选结果
    const filterFiles = fs.readdirSync(dataDir).filter(f => f.startsWith('filtered_posts_'));
    if (filterFiles.length === 0) {
      console.error('❌ 未找到筛选结果，请先运行 filter-posts.js');
      process.exit(1);
    }

    const latestFilter = filterFiles.sort().pop();
    const filterData = JSON.parse(fs.readFileSync(path.join(dataDir, latestFilter), 'utf8'));
    
    console.log(`📂 加载筛选结果: ${latestFilter}`);
    console.log(`🎯 需要翻译: ${filterData.qualified.length} 个帖子\n`);

    // 获取帖子详情
    const fetcher = new RedditFetcher({ dataDir });
    const postDetails = [];

    for (const item of filterData.qualified) {
      console.log(`📄 获取详情: ${item.id}`);
      const detail = await fetcher.fetchPostDetail(item.id, item.permalink);
      if (detail) {
        const summary = fetcher.summarizeAuthorContent(detail);
        postDetails.push(summary);
      }
      await fetcher.delay(1000);
    }

    console.log(`\n✅ 获取 ${postDetails.length} 个帖子详情，开始翻译...\n`);

    // 翻译
    const translator = new Translator({ dataDir, translationsDir });
    const translations = await translator.translatePosts(postDetails);

    // 生成索引
    translator.generateIndex(translations);

    console.log(`\n✅ 翻译完成!`);
    console.log(`📁 翻译文件保存在: ${translationsDir}`);
  })();
}
