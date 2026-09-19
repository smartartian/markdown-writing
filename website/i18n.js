const STORAGE_KEY = 'markdown-writing-site-language';

const MESSAGES = {
  'meta.title': { zh: 'Markdown Writing - 本地优先的 Markdown 桌面写作工具', en: 'Markdown Writing - Local-first Markdown Editor for macOS' },
  'meta.description': { zh: '面向 macOS Apple Silicon 的本地优先 Markdown 桌面写作工具，提供可靠保存、版本恢复、主题系统与插件管理。', en: 'A local-first Markdown editor for Apple Silicon Macs, with reliable saving, version recovery, themes, and plugin management.' },
  'skip.link': { zh: '跳到主要内容', en: 'Skip to main content' },
  'nav.capabilities': { zh: '能力', en: 'Capabilities' },
  'nav.workflow': { zh: '工作流', en: 'Workflow' },
  'nav.safety': { zh: '可靠性', en: 'Reliability' },
  'nav.themes': { zh: '主题', en: 'Themes' },
  'nav.updates': { zh: '更新记录', en: 'Updates' },
  'nav.github': { zh: 'GitHub', en: 'GitHub' },
  'lang.label': { zh: '界面语言', en: 'Language' },
  'action.download': { zh: '下载', en: 'Download' },
  'action.downloadMac': { zh: '下载 macOS', en: 'Download for macOS' },
  'action.downloadSilicon': { zh: '下载 Apple Silicon 版', en: 'Download for Apple Silicon' },
  'action.downloadPage': { zh: '前往下载页', en: 'Open download page' },
  'action.install': { zh: '安装说明', en: 'Installation guide' },
  'action.explore': { zh: '查看产品能力', en: 'Explore capabilities' },
  'action.themes': { zh: '查看主题效果', en: 'Explore themes' },
  'action.details': { zh: '查看安全设计', en: 'Read safety design' },
  'action.githubReleases': { zh: '查看 GitHub Releases', en: 'View GitHub Releases' },
  'action.source': { zh: '查看源码', en: 'View source' },
  'action.refresh': { zh: '重新同步', en: 'Refresh' },
  'action.openGithub': { zh: '在 GitHub 查看', en: 'View on GitHub' },
  'footer.tagline': { zh: '本地优先的 macOS Markdown 桌面写作工具。', en: 'A local-first Markdown editor for Apple Silicon Macs.' },
  'home.hero.eyebrow': { zh: '本地优先的写作工作台', en: 'Local-first writing workspace' },
  'home.hero.lead': { zh: '面向 macOS Apple Silicon 的 Markdown 桌面写作工具。文件留在磁盘，内容、版本、主题和扩展能力都保持清晰可控。', en: 'A Markdown editor built for Apple Silicon Macs. Your files stay on disk, while content, versions, themes, and extensions remain clear and controllable.' },
  'home.hero.noteTitle': { zh: '把编辑、保存、恢复和导出放进同一个安静的工作台。', en: 'Editing, saving, recovery, and export live in one quiet workspace.' },
  'home.hero.noteBody': { zh: '工作区中的主题令牌与真实桌面端一致。切换主题时，侧栏、正文、浮层和状态栏会同步变化。', en: 'The workspace below uses the same theme tokens as the desktop app. Sidebar, document, overlays, and status bar update together.' },
  'home.meta.local': { zh: '本地文件', en: 'Local files' },
  'home.meta.atomic': { zh: '原子保存', en: 'Atomic saves' },
  'home.meta.source': { zh: '源文可控', en: 'Source control' },
  'preview.kicker': { zh: '交互预览', en: 'Interactive preview' },
  'preview.hint': { zh: '点击主题、文件或导出按钮体验', en: 'Try themes, files, or export' },
  'preview.title': { zh: '写作计划.md', en: 'writing-plan.md' },
  'preview.saved': { zh: '本地已保存', en: 'Saved locally' },
  'preview.brand': { zh: 'Markdown Writing', en: 'Markdown Writing' },
  'preview.files': { zh: '文件', en: 'Files' },
  'preview.outline': { zh: '大纲', en: 'Outline' },
  'preview.settings': { zh: '设置', en: 'Settings' },
  'preview.docs': { zh: '文档', en: 'docs' },
  'preview.plan': { zh: '写作计划.md', en: 'writing-plan.md' },
  'preview.notes': { zh: '产品手记.md', en: 'product-notes.md' },
  'preview.release': { zh: '发布说明.md', en: 'release-notes.md' },
  'preview.notes.heading': { zh: '记录产品判断，也记录取舍', en: 'Record product decisions and the tradeoffs behind them' },
  'preview.notes.body': { zh: '产品手记把问题、判断与后续动作放在同一篇文档里，便于回看当时为什么这样选择。', en: 'Product notes keep the problem, decision, and next action in one document so the reasoning remains inspectable later.' },
  'preview.release.heading': { zh: '让每次发布都有清晰边界', en: 'Give every release a clear boundary' },
  'preview.release.body': { zh: '发布说明只保留用户能够感知的变化、已知限制和升级注意事项，不把提交记录直接当作产品更新。', en: 'Release notes focus on user-visible changes, known limits, and upgrade notes instead of treating commit history as a product update.' },
  'preview.documentMeta': { zh: '本地文件 · 自动保存', en: 'Local file · Autosaved' },
  'preview.today': { zh: '今天 / 2026.09.19', en: 'Today / 2026.09.19' },
  'preview.heading': { zh: '把注意力留给正在发生的句子', en: 'Keep your attention on the sentence at hand' },
  'preview.body': { zh: '写作应当接近纸面：打开即写，内容留存在本地。需要时再切换源码、恢复历史版本，或导出成适合分享的格式。', en: 'Writing should feel close to paper: open and write, keep the source local, switch to Markdown when needed, and export only when the work is ready to share.' },
  'preview.quote': { zh: '没有堆积的工具栏，只有文字、结构和随时可回看的 Markdown 源文。', en: 'No crowded toolbar. Just text, structure, and Markdown source you can inspect at any time.' },
  'preview.task1': { zh: '完成块编辑器改造', en: 'Finish the block editor update' },
  'preview.task2': { zh: '补齐主题与亮暗模式', en: 'Complete themes and light/dark modes' },
  'preview.task3': { zh: '生成官网交互原型', en: 'Build the interactive website preview' },
  'preview.source': { zh: '源码', en: 'Source' },
  'preview.preview': { zh: '预览', en: 'Preview' },
  'preview.find': { zh: '查找', en: 'Find' },
  'preview.history': { zh: '版本历史', en: 'Version history' },
  'preview.export': { zh: '导出', en: 'Export' },
  'preview.outline.h1': { zh: '项目概览', en: 'Project overview' },
  'preview.outline.h2': { zh: '当前进度', en: 'Current progress' },
  'preview.outline.h3': { zh: '实现说明', en: 'Implementation notes' },
  'preview.find.replace': { zh: '替换', en: 'Replace' },
  'preview.find.close': { zh: '关闭', en: 'Close' },
  'preview.find.replaceOne': { zh: '替换', en: 'Replace' },
  'preview.find.replaceAll': { zh: '全部替换', en: 'Replace all' },
  'preview.find.query': { zh: '保存', en: 'save' },
  'preview.find.replacement': { zh: '保存', en: 'save' },
  'preview.conflict.title': { zh: '检测到外部修改', en: 'External change detected' },
  'preview.conflict.body': { zh: '磁盘上的文件已被其他程序修改，请选择重新载入或保留当前内容。', en: 'The file changed on disk. Reload it or keep the current editor content.' },
  'preview.conflict.reload': { zh: '重新载入', en: 'Reload' },
  'preview.conflict.keep': { zh: '保留本地', en: 'Keep local' },
  'preview.history.kicker': { zh: 'HISTORY', en: 'HISTORY' },
  'preview.history.title': { zh: '版本历史', en: 'Version history' },
  'preview.history.latest': { zh: '当前版本', en: 'Current version' },
  'preview.history.current': { zh: '当前版本', en: 'Current version' },
  'preview.history.restore': { zh: '恢复', en: 'Restore' },
  'preview.history.v11': { zh: '补齐主题与亮暗模式', en: 'Complete themes and light/dark modes' },
  'preview.history.v10': { zh: '完成块编辑器改造', en: 'Finish the block editor update' },
  'preview.history.latestBody': { zh: '保存、版本与恢复共享同一条链路', en: 'Saving, versions, and recovery share one path' },
  'preview.settings.kicker': { zh: 'SETTINGS', en: 'SETTINGS' },
  'preview.settings.title': { zh: '设置工作台', en: 'Settings workspace' },
  'preview.settings.system': { zh: '系统', en: 'System' },
  'preview.settings.appearance': { zh: '外观', en: 'Appearance' },
  'preview.settings.plugins': { zh: '插件', en: 'Plugins' },
  'preview.settings.language': { zh: '界面语言', en: 'Interface language' },
  'preview.settings.followSystem': { zh: '跟随系统，可手动切换', en: 'Follow system or choose manually' },
  'preview.settings.followSystemValue': { zh: '跟随系统', en: 'Follow system' },
  'preview.settings.localFiles': { zh: '本地文件', en: 'Local files' },
  'preview.settings.localFilesBody': { zh: '文档保留在原目录', en: 'Documents remain in their folders' },
  'preview.settings.theme': { zh: '主题模式', en: 'Theme mode' },
  'preview.settings.themeBody': { zh: '亮色与暗色可以独立选择', en: 'Choose light and dark themes independently' },
  'preview.settings.systemMode': { zh: '跟随系统', en: 'System' },
  'preview.settings.contentWidth': { zh: '正文宽度', en: 'Content width' },
  'preview.settings.contentWidthBody': { zh: '默认百分之七十', en: 'Default 70 percent' },
  'preview.settings.running': { zh: '运行中', en: 'Running' },
  'preview.settings.protected': { zh: '受保护', en: 'Protected' },
  'preview.export.title': { zh: '导出当前文档', en: 'Export document' },
  'preview.export.text': { zh: '纯文本', en: 'Plain text' },
  'preview.export.word': { zh: 'Word 文档', en: 'Word document' },
  'preview.code': { zh: '## 今日写作\n\n- 保持本地文件为唯一事实来源\n- 保存、版本与恢复共享同一条链路\n- 让主题跟随写作环境自然切换', en: '## Today writing\n\n- Keep local files as the source of truth\n- Saving, versions, and recovery share one path\n- Let themes follow the writing environment' },
  'preview.lines': { zh: '行 12', en: '12 lines' },
  'preview.words': { zh: '字数 638', en: '638 words' },
  'preview.themeSummary': { zh: '{theme} / {mode}', en: '{theme} / {mode}' },
  'theme.paper': { zh: '纸张', en: 'Paper' },
  'theme.sepia': { zh: '书页米黄', en: 'Sepia Page' },
  'theme.graphite': { zh: '石墨', en: 'Graphite' },
  'theme.ocean': { zh: '深海', en: 'Ocean' },
  'mode.light': { zh: '亮色', en: 'Light' },
  'mode.dark': { zh: '暗色', en: 'Dark' },
  'scenario.title': { zh: '场景演示', en: 'Scenario walkthrough' },
  'scenario.open': { zh: '打开目录', en: 'Open folder' },
  'scenario.write': { zh: '开始写作', en: 'Start writing' },
  'scenario.conflict': { zh: '处理冲突', en: 'Resolve conflict' },
  'scenario.history': { zh: '恢复版本', en: 'Restore version' },
  'scenario.export': { zh: '导出交付', en: 'Export' },
  'scenario.next': { zh: '下一步', en: 'Next step' },
  'scenario.restart': { zh: '重新开始', en: 'Start over' },
  'preview.toast.workspace': { zh: '已打开本地文档目录，文件树与大纲可以切换。', en: 'Local workspace opened. The file tree and outline are ready.' },
  'preview.toast.writing': { zh: '已进入预览模式，正文与自动保存状态同步。', en: 'Preview mode is active with autosave status in sync.' },
  'preview.toast.conflict': { zh: '已模拟外部修改，请选择重新载入或保留本地。', en: 'An external change is ready. Reload it or keep the local version.' },
  'preview.toast.history': { zh: '版本历史已打开，可以检查并恢复最近快照。', en: 'Version history is open with recent snapshots ready to restore.' },
  'preview.toast.export': { zh: '导出菜单已打开，请选择交付格式。', en: 'The export menu is open. Choose a delivery format.' },
  'preview.toast.restored': { zh: '已恢复版本 v{version}。', en: 'Version v{version} restored.' },
  'preview.toast.settings': { zh: '设置工作台已打开。', en: 'Settings workspace opened.' },
  'preview.toast.reload': { zh: '已重新载入磁盘上的最新版本。', en: 'Reloaded the latest version from disk.' },
  'preview.toast.keep': { zh: '当前内容已保留，等待下一次提交。', en: 'Local content kept for the next save.' },
  'preview.toast.exported': { zh: '已生成 {format} 导出任务。', en: 'Prepared the {format} export.' },
  'preview.toast.replaced': { zh: '已替换 {count} 处匹配内容。', en: 'Replaced {count} matches.' },
  'proof.local.title': { zh: '普通 Markdown 文件', en: 'Plain Markdown files' },
  'proof.local.body': { zh: '内容留在自己的目录，不被锁进私有格式。', en: 'Keep content in your own folders, never locked into a proprietary format.' },
  'proof.silicon.title': { zh: 'Apple Silicon 原生', en: 'Built for Apple Silicon' },
  'proof.silicon.body': { zh: '当前版本面向 M 系列 Mac，安装路径与下载入口保持单一。', en: 'The current release targets M-series Macs with a focused install and download path.' },
  'proof.open.title': { zh: '开放源码', en: 'Open source' },
  'proof.open.body': { zh: '编辑器核心、插件运行时和官网实现都可以直接审阅。', en: 'The editor core, plugin runtime, and website implementation are open to inspection.' },
  'capabilities.eyebrow': { zh: '为长期写作而设计', en: 'Designed for long-form work' },
  'capabilities.title': { zh: '功能不堆叠，每一层都围绕文档。', en: 'No feature pileup. Every layer serves the document.' },
  'capabilities.lead': { zh: '从输入、组织、恢复到交付，每一项能力都对应真实写作流程中的一步。', en: 'From typing and organization to recovery and delivery, each capability maps to a real step in the writing process.' },
  'capabilities.editor.title': { zh: '块编辑与源码并存', en: 'Block editing with source access' },
  'capabilities.editor.body': { zh: '在结构化视图中自然书写，需要精确控制时立即切回 Markdown 源文。支持选择映射、组合输入和模型级撤销重做。', en: 'Write naturally in a structured view, then switch to Markdown source for precise control. Selection mapping, composition, and model-level undo/redo are built in.' },
  'capabilities.find.title': { zh: '查找与替换', en: 'Find and replace' },
  'capabilities.find.body': { zh: '在当前文档中查找、切换匹配项、替换单个结果或全部替换，并支持区分大小写。', en: 'Find, navigate matches, replace one or all results, and optionally match case inside the current document.' },
  'capabilities.workspace.title': { zh: '文档树与大纲', en: 'File tree and outline' },
  'capabilities.workspace.body': { zh: '按目录组织稿件，通过最近文档快速返回，并用大纲在长文中稳定巡航。', en: 'Organize drafts by folder, return through recent files, and move through long documents with the outline.' },
  'capabilities.export.title': { zh: '一份内容，多种交付', en: 'One document, many deliveries' },
  'capabilities.export.body': { zh: '保留 Markdown 原文件，并按需要导出纯文本、PNG、PDF 或 Word 可打开的文档格式。', en: 'Keep the Markdown source and export plain text, PNG, PDF, or a Word-compatible document when needed.' },
  'themes.eyebrow': { zh: '同一工作区，四种气质', en: 'One workspace, four characters' },
  'themes.title': { zh: '主题不是换一层颜色，而是重排整个工作环境。', en: 'Themes are not a color swap. They reshape the whole workspace.' },
  'themes.lead': { zh: 'Paper、Sepia、Graphite、Ocean 都包含亮色与暗色版本。系统模式可以为亮暗环境分别选择主题。', en: 'Paper, Sepia, Graphite, and Ocean each include light and dark variants. System mode can use a different family for each appearance.' },
  'themes.custom': { zh: 'JSON 用户主题', en: 'JSON user themes' },
  'themes.customBody': { zh: '导入、复制、导出和删除自己的主题配置，预览会跟随当前编辑器令牌。', en: 'Import, duplicate, export, and remove custom themes while previews follow the active editor tokens.' },
  'safety.eyebrow': { zh: '数据安全不是附加项', en: 'Data safety is not an add-on' },
  'safety.title': { zh: '先保证不丢，再谈功能。', en: 'Protect the work first. Everything else follows.' },
  'safety.lead': { zh: '从 revision 校验到原子写入，再到版本历史、回收站与崩溃恢复，所有保存路径都围绕同一原则设计：不静默覆盖。', en: 'From revision checks and atomic writes to version history, recycle bin, and crash recovery, every save path follows one rule: never overwrite silently.' },
  'safety.item1.title': { zh: 'Revision 冲突检测', en: 'Revision conflict detection' },
  'safety.item1.body': { zh: '外部修改不会被静默覆盖。', en: 'External changes are never overwritten silently.' },
  'safety.item2.title': { zh: '原子替换', en: 'Atomic replacement' },
  'safety.item2.body': { zh: '临时文件写完后替换原文档。', en: 'The original is replaced only after the temporary file is complete.' },
  'safety.item3.title': { zh: '版本历史', en: 'Version history' },
  'safety.item3.body': { zh: '保留最近 50 个自动保存快照。', en: 'Keep the latest 50 autosave snapshots.' },
  'safety.item4.title': { zh: '回收站恢复', en: 'Recycle bin recovery' },
  'safety.item4.body': { zh: '误删文档可恢复到原路径。', en: 'Restore deleted documents to their original paths.' },
  'safety.item5.title': { zh: '崩溃恢复', en: 'Crash recovery' },
  'safety.item5.body': { zh: '启动时识别未落盘的编辑现场。', en: 'Detect unfinished editing sessions on the next launch.' },
  'release.eyebrow': { zh: 'GitHub Releases', en: 'GitHub Releases' },
  'release.title': { zh: '最新版本', en: 'Latest release' },
  'release.loading': { zh: '正在读取版本信息...', en: 'Loading release information...' },
  'release.repo': { zh: 'GitHub Releases', en: 'GitHub Releases' },
  'release.empty': { zh: '等待首个公开版本', en: 'Waiting for the first public release' },
  'release.emptyBody': { zh: '发布后，官网会自动同步版本、更新说明和 macOS Apple Silicon 下载入口。', en: 'Once published, the website will sync the version, release notes, and Apple Silicon download automatically.' },
  'release.notesFallback': { zh: '该版本暂未填写更新说明。', en: 'No release notes were provided for this version.' },
  'release.assetMissing': { zh: '暂未找到 macOS Apple Silicon 安装包。', en: 'No macOS Apple Silicon package is available yet.' },
  'release.downloadHint': { zh: '仅支持 macOS M 系列', en: 'Apple Silicon Macs only' },
  'download.eyebrow': { zh: 'macOS Apple Silicon', en: 'macOS Apple Silicon' },
  'download.title': { zh: '把下一篇文章，写在自己的磁盘上。', en: 'Write your next piece on your own disk.' },
  'download.lead': { zh: '当前版本仅支持 M1、M2、M3、M4 及后续 Apple Silicon 芯片。', en: 'The current release supports M1, M2, M3, M4, and later Apple Silicon chips.' },
  'download.requirement': { zh: '需要 macOS 与 Apple Silicon 芯片。应用当前未签名，首次打开请按系统提示确认。', en: 'Requires macOS and an Apple Silicon chip. The app is currently unsigned, so confirm the system prompt when opening it for the first time.' },
  'updates.metaTitle': { zh: '更新记录 - Markdown Writing', en: 'Updates - Markdown Writing' },
  'updates.metaDescription': { zh: '同步 Markdown Writing 在 GitHub Releases 发布的版本、时间和更新说明。', en: 'Version history, release dates, and notes synced from GitHub Releases.' },
  'updates.heroEyebrow': { zh: 'Release archive', en: 'Release archive' },
  'updates.heroTitle': { zh: '更新记录', en: 'Updates' },
  'updates.heroLead': { zh: '这里展示 Markdown Writing 在 GitHub 发布的版本、时间和更新说明。官网不维护另一份版本列表。', en: 'Browse versions, dates, and notes published through GitHub Releases. The website does not maintain a separate release list.' },
  'updates.source': { zh: '数据源', en: 'Source' },
  'updates.sourceHint': { zh: '版本数据来自 GitHub Releases', en: 'Release data comes from GitHub Releases' },
  'updates.waiting': { zh: '等待同步', en: 'Waiting to sync' },
  'updates.loading': { zh: '正在从 GitHub 获取更新记录...', en: 'Loading releases from GitHub...' },
  'updates.synced': { zh: '最近同步：{time}', en: 'Last synced: {time}' },
  'updates.syncFailed': { zh: '同步失败', en: 'Sync failed' },
  'updates.emptyTitle': { zh: '还没有公开版本', en: 'No public releases yet' },
  'updates.emptyBody': { zh: 'GitHub Releases 中暂时没有可展示的版本记录。发布后，这里会自动同步。', en: 'There are no published releases to display yet. This page will update automatically.' },
  'updates.errorTitle': { zh: '暂时无法读取 GitHub 更新', en: 'Unable to load GitHub releases' },
  'updates.errorFallback': { zh: '网络请求失败，请稍后重试。', en: 'The request failed. Please try again later.' },
  'updates.retry': { zh: '重新加载', en: 'Try again' },
  'updates.stable': { zh: '正式版', en: 'Stable' },
  'updates.preview': { zh: '预览版', en: 'Pre-release' },
  'updates.draft': { zh: '草稿', en: 'Draft' },
  'updates.untitled': { zh: '未命名版本', en: 'Untitled release' },
  'updates.noNotes': { zh: '该版本暂未填写更新说明。', en: 'No release notes were provided for this version.' },
  'updates.originalNotes': { zh: '原始发布说明', en: 'Original release notes' },
  'docs.metaTitle': { zh: '数据安全设计 - Markdown Writing', en: 'Data Safety - Markdown Writing' },
  'docs.metaDescription': { zh: '了解 Markdown Writing 的保存、冲突处理、版本历史和恢复机制。', en: 'How Markdown Writing handles saves, conflicts, version history, and recovery.' },
  'docs.heroEyebrow': { zh: 'Data safety', en: 'Data safety' },
  'docs.heroTitle': { zh: '先保证不丢，再谈功能。', en: 'Protect the work first. Everything else follows.' },
  'docs.heroLead': { zh: 'Markdown Writing 把本地文件视为唯一事实来源。保存、冲突处理、历史恢复和退出保护都围绕这条原则设计。', en: 'Markdown Writing treats local files as the source of truth. Saving, conflict handling, history recovery, and exit protection are designed around that principle.' },
  'docs.sidebarTitle': { zh: '安全设计', en: 'Safety design' },
  'docs.nav.principles': { zh: '设计原则', en: 'Principles' },
  'docs.nav.save': { zh: '保存流程', en: 'Save flow' },
  'docs.nav.conflicts': { zh: '外部冲突', en: 'Conflicts' },
  'docs.nav.history': { zh: '历史与回收站', en: 'History' },
  'docs.nav.recovery': { zh: '退出与恢复', en: 'Recovery' },
  'docs.nav.boundaries': { zh: '能力边界', en: 'Boundaries' },
  'docs.principles.title': { zh: '设计原则', en: 'Design principles' },
  'docs.principles.body': { zh: '编辑器的第一责任不是让界面显得智能，而是在异常、误操作和多窗口竞争发生时，尽量不让用户失去已经写下的内容。', en: 'The editor prioritizes preserving written work over appearing intelligent, especially during failures, mistakes, or multi-window conflicts.' },
  'docs.principles.item1': { zh: '本地优先：普通 Markdown 文件保留在磁盘，应用不会把文档锁进私有格式。', en: 'Local first: plain Markdown files remain on disk and are never locked into a proprietary format.' },
  'docs.principles.item2': { zh: '写入可验证：每次保存都携带 revision 和内容哈希，版本不一致时停止覆盖。', en: 'Verifiable writes: every save carries a revision and content hash, and stops when versions do not match.' },
  'docs.principles.item3': { zh: '恢复优先于报错：冲突、崩溃和误删除都提供可执行的恢复路径。', en: 'Recovery before errors: conflicts, crashes, and accidental deletions all offer an actionable recovery path.' },
  'docs.principles.item4': { zh: '用户保留决定权：外部修改时，可以重新载入、保留本地版本或另存副本。', en: 'The user decides: reload external changes, keep the local version, or save a separate copy.' },
  'docs.save.title': { zh: '一次保存经历什么', en: 'What happens during a save' },
  'docs.save.body': { zh: '自动保存和手动保存共用同一条提交路径，不会出现两种保存方式背后行为不一致的问题。', en: 'Automatic and manual saves share one commit path, avoiding hidden differences between them.' },
  'docs.save.step1.title': { zh: '校验当前版本', en: 'Verify the current revision' },
  'docs.save.step1.body': { zh: '提交时携带 revision 与内容哈希，确认应用读取的版本仍是磁盘上的当前版本。', en: 'The save carries a revision and content hash to confirm the app is still working from the current on-disk version.' },
  'docs.save.step2.title': { zh: '写入临时文件', en: 'Write a temporary file' },
  'docs.save.step2.body': { zh: '新内容先写到目标目录中的临时文件，避免原文件在写入中被截断。', en: 'New content is written to a temporary file in the target directory so the original is never partially truncated.' },
  'docs.save.step3.title': { zh: '原子替换原文件', en: 'Replace atomically' },
  'docs.save.step3.body': { zh: '内容完整写入后替换原文件，再做必要的清理。', en: 'The original is replaced only after the new content is complete, followed by necessary cleanup.' },
  'docs.save.step4.title': { zh: '记录版本与恢复状态', en: 'Record versions and recovery state' },
  'docs.save.step4.body': { zh: '保存成功后更新 revision、写入历史快照，并清理已经落盘的恢复内容。', en: 'A successful save updates the revision, writes a history snapshot, and clears recovery state that is no longer needed.' },
  'docs.save.calloutTitle': { zh: '保存失败不回滚编辑状态', en: 'A failed save does not roll back the editor' },
  'docs.save.calloutBody': { zh: '页面继续保持 dirty 状态，恢复快照也会保留。用户可以重试、另存或先复制内容。', en: 'The editor remains dirty and recovery snapshots stay available, so the user can retry, save elsewhere, or copy the content.' },
  'docs.conflicts.title': { zh: '外部修改与冲突处理', en: 'External changes and conflicts' },
  'docs.conflicts.body': { zh: '应用会检查当前文件的内容哈希和 revision。文件被其他编辑器修改、删除或重命名后，页面会明确说明冲突，而不是继续静默自动保存。', en: 'The app checks the file content hash and revision. If another editor changes, deletes, or renames the file, the document reports a conflict instead of silently autosaving.' },
  'docs.conflicts.item1': { zh: '重新载入：放弃本地未保存版本，读取磁盘上的最新内容。', en: 'Reload: discard the local unsaved version and read the latest disk content.' },
  'docs.conflicts.item2': { zh: '保留本地并覆盖：在确认磁盘版本后，用应用中的内容重新提交。', en: 'Keep local and overwrite: after reviewing the disk version, commit the editor content again.' },
  'docs.conflicts.item3': { zh: '另存副本：把当前内容保存到新路径，保留双方版本。', en: 'Save a copy: write the current content to a new path and keep both versions.' },
  'docs.history.title': { zh: '历史与回收站', en: 'History and recycle bin' },
  'docs.history.body': { zh: '版本历史保存最近 50 个自动保存快照。恢复历史版本同样需要提供当前 revision，避免覆盖另一个窗口刚完成的保存。', en: 'Version history keeps the latest 50 autosave snapshots. Restoring an old version still checks the current revision to avoid overwriting a recent save from another window.' },
  'docs.history.scenario': { zh: '场景', en: 'Scenario' },
  'docs.history.action': { zh: '保护动作', en: 'Protection' },
  'docs.history.entry': { zh: '恢复入口', en: 'Recovery entry' },
  'docs.history.row1': { zh: '误覆盖内容', en: 'Content overwritten' },
  'docs.history.row1Action': { zh: '保存前生成历史快照', en: 'Create a snapshot before saving' },
  'docs.history.row1Entry': { zh: '版本历史中恢复', en: 'Restore from version history' },
  'docs.history.row2': { zh: '误删除文档', en: 'Document deleted' },
  'docs.history.row2Action': { zh: '文件先移动到应用回收站', en: 'Move the file to the app recycle bin' },
  'docs.history.row2Entry': { zh: '恢复到原路径', en: 'Restore to the original path' },
  'docs.history.row3': { zh: '外部文件消失', en: 'External file removed' },
  'docs.history.row3Action': { zh: '保留编辑内容与恢复快照', en: 'Keep editor content and snapshots' },
  'docs.history.row3Entry': { zh: '重新载入或另存副本', en: 'Reload or save a copy' },
  'docs.recovery.title': { zh: '退出与崩溃恢复', en: 'Exit and crash recovery' },
  'docs.recovery.body1': { zh: '存在未保存内容时，退出流程会先尝试完成保存，并列出仍未落盘的文档。正常关闭后清理恢复状态，异常退出则保留下一次启动可读取的快照。', en: 'When unsaved content exists, exit first attempts to save and lists any documents still not written. A normal close clears recovery state; an unexpected exit leaves a snapshot for the next launch.' },
  'docs.recovery.body2': { zh: '恢复快照包含文档、内容、revision、内容哈希、编辑模型版本和最后事务编号。启动时若发现未处理快照，会询问恢复还是丢弃。', en: 'A recovery snapshot includes the document, content, revision, content hash, editor model version, and last transaction ID. On launch, the app asks whether to restore or discard it.' },
  'docs.recovery.calloutTitle': { zh: '恢复也有版本边界', en: 'Recovery still respects revisions' },
  'docs.recovery.calloutBody': { zh: '恢复内容仍需经过当前文档版本校验。如果磁盘文件已经变化，应用会进入冲突处理流程。', en: 'Recovered content still goes through revision checks. If the disk file changed, the app enters the conflict flow.' },
  'docs.boundaries.title': { zh: '能力边界', en: 'Boundaries' },
  'docs.boundaries.body': { zh: '这些机制主要防止正常使用中的误覆盖、进程中断和文件竞争，不能替代系统备份或磁盘加密。', en: 'These mechanisms reduce accidental overwrites, interrupted processes, and file conflicts. They do not replace system backups or disk encryption.' },
  'docs.boundaries.item1': { zh: '应用不会把文档上传到云端，网络只用于读取 GitHub Releases 等明确功能。', en: 'Documents are not uploaded to the cloud. Network access is limited to explicit features such as GitHub Releases.' },
  'docs.boundaries.item2': { zh: '应用数据目录包含历史版本和回收站元数据，应纳入系统备份。', en: 'The application data directory contains version history and recycle bin metadata and should be included in system backups.' },
  'docs.boundaries.item3': { zh: '如果磁盘损坏、权限被拒绝或系统工具直接改写文件，应用会尽量保留恢复副本，但无法保证物理介质本身可恢复。', en: 'If storage fails, permissions are denied, or another system tool rewrites a file, the app preserves recovery copies where possible but cannot recover the physical medium itself.' },
  'docs.boundaries.item4': { zh: '涉及敏感内容时，应配合加密磁盘、文件权限和可信备份策略使用。', en: 'For sensitive material, combine the app with encrypted storage, file permissions, and a trusted backup strategy.' },
  'install.metaTitle': { zh: '安装说明 - Markdown Writing', en: 'Installation - Markdown Writing' },
  'install.metaDescription': { zh: 'Markdown Writing 的 macOS Apple Silicon 安装、首次启动与故障排查说明。', en: 'Installation, first launch, and troubleshooting instructions for Markdown Writing on Apple Silicon Macs.' },
  'install.heroEyebrow': { zh: 'macOS installation', en: 'macOS installation' },
  'install.heroTitle': { zh: '安装 Markdown Writing', en: 'Install Markdown Writing' },
  'install.heroLead': { zh: '当前版本仅面向 Apple Silicon Mac。按照以下步骤下载、安装并完成首次启动。', en: 'The current release is built only for Apple Silicon Macs. Follow these steps to download, install, and launch it for the first time.' },
  'install.nav.requirements': { zh: '系统要求', en: 'Requirements' },
  'install.nav.steps': { zh: '安装步骤', en: 'Install steps' },
  'install.nav.firstRun': { zh: '首次启动', en: 'First launch' },
  'install.nav.updates': { zh: '后续更新', en: 'Updates' },
  'install.nav.troubleshooting': { zh: '故障排查', en: 'Troubleshooting' },
  'install.requirements.title': { zh: '系统要求', en: 'System requirements' },
  'install.requirements.body': { zh: '下载前请确认设备符合要求。目前不提供 Intel Mac、Windows 或 Linux 版本。', en: 'Confirm your device before downloading. Intel Mac, Windows, and Linux packages are not currently provided.' },
  'install.requirements.cpu': { zh: 'Apple Silicon 芯片', en: 'Apple Silicon chip' },
  'install.requirements.cpuBody': { zh: '支持 M1、M2、M3、M4 及后续 M 系列芯片。', en: 'Supports M1, M2, M3, M4, and later M-series chips.' },
  'install.requirements.os': { zh: 'macOS', en: 'macOS' },
  'install.requirements.osBody': { zh: '使用当前受支持的 macOS 版本，并保持系统更新。', en: 'Use a currently supported version of macOS and keep the system updated.' },
  'install.requirements.signing': { zh: '未签名构建', en: 'Unsigned build' },
  'install.requirements.signingBody': { zh: '首次打开时，macOS 可能要求你在系统设置中确认。', en: 'macOS may ask you to confirm the app in System Settings on first launch.' },
  'install.steps.title': { zh: '安装步骤', en: 'Installation steps' },
  'install.steps.step1Title': { zh: '下载安装包', en: 'Download the package' },
  'install.steps.step1Body': { zh: '从官网或 GitHub Releases 下载文件名包含 arm64 或 apple-silicon 的版本。', en: 'Download the package labeled arm64 or apple-silicon from this website or GitHub Releases.' },
  'install.steps.step2Title': { zh: '解压或打开 DMG', en: 'Extract or open the DMG' },
  'install.steps.step2Body': { zh: '如果下载的是 ZIP，请先解压；如果下载的是 DMG，请双击打开。', en: 'If you downloaded a ZIP, extract it first. If you downloaded a DMG, open it directly.' },
  'install.steps.step3Title': { zh: '移动到应用程序', en: 'Move to Applications' },
  'install.steps.step3Body': { zh: '将 Markdown Writing 拖入“应用程序”文件夹，再从该位置启动。', en: 'Drag Markdown Writing into Applications and launch it from that location.' },
  'install.steps.step4Title': { zh: '确认首次启动', en: 'Confirm first launch' },
  'install.steps.step4Body': { zh: '如果系统阻止打开，请在“系统设置 → 隐私与安全性”中允许本次打开。', en: 'If macOS blocks the app, allow it from System Settings → Privacy & Security.' },
  'install.firstRun.title': { zh: '首次启动', en: 'First launch' },
  'install.firstRun.body': { zh: '第一次启动不需要登录，也不会要求上传文档。你可以打开本地文件夹，或先创建一篇新文档。', en: 'The first launch requires no sign-in and does not upload documents. Open a local folder or create a new document.' },
  'install.firstRun.noteTitle': { zh: '关于“未验证的开发者”', en: 'About “unidentified developer”' },
  'install.firstRun.noteBody': { zh: '这是未签名构建可能出现的提示。只应从项目官网或官方 GitHub Releases 下载安装包。', en: 'This warning can appear for unsigned builds. Download packages only from this website or the official GitHub Releases page.' },
  'install.updates.title': { zh: '后续更新', en: 'Future updates' },
  'install.updates.body': { zh: '应用内的设置页可以检查版本。官网更新记录会同步 GitHub Releases 的版本和说明。', en: 'Check the version from Settings inside the app. The website syncs versions and notes from GitHub Releases.' },
  'install.troubleshooting.title': { zh: '故障排查', en: 'Troubleshooting' },
  'install.troubleshooting.item1': { zh: '如果提示“应用已损坏”，请重新下载，并确认解压后的应用位于“应用程序”目录。', en: 'If macOS reports that the app is damaged, download it again and confirm the extracted app is in Applications.' },
  'install.troubleshooting.item2': { zh: '如果应用无法打开，请确认设备使用 Apple Silicon，而不是 Intel 处理器。', en: 'If the app cannot open, confirm that the Mac uses Apple Silicon rather than an Intel processor.' },
  'install.troubleshooting.item3': { zh: '问题持续存在时，请在 GitHub Issues 中附上 macOS 版本、芯片型号和完整提示。', en: 'If the issue continues, include the macOS version, chip model, and full message in a GitHub Issue.' },
  'install.action.openReleases': { zh: '打开 GitHub Releases', en: 'Open GitHub Releases' },
  'install.action.openIssues': { zh: '查看 GitHub Issues', en: 'View GitHub Issues' },
  'downloadPage.metaTitle': { zh: '下载 - Markdown Writing', en: 'Download - Markdown Writing' },
  'downloadPage.metaDescription': { zh: '下载面向 macOS Apple Silicon 的 Markdown Writing 桌面版。', en: 'Download Markdown Writing for macOS Apple Silicon.' },
  'downloadPage.heroEyebrow': { zh: 'macOS Apple Silicon', en: 'macOS Apple Silicon' },
  'downloadPage.heroTitle': { zh: '下载 Markdown Writing', en: 'Download Markdown Writing' },
  'downloadPage.heroLead': { zh: '当前版本仅支持 Apple Silicon Mac。下载前请确认芯片型号，并查看系统要求。', en: 'The current release supports Apple Silicon Macs only. Confirm your chip and review the requirements before downloading.' },
  'downloadPage.platformChip': { zh: 'M1 / M2 / M3 / M4 及后续芯片', en: 'M1 / M2 / M3 / M4 and later' },
  'downloadPage.releaseKicker': { zh: 'CURRENT RELEASE', en: 'CURRENT RELEASE' },
  'downloadPage.releaseTitle': { zh: '当前版本', en: 'Current release' },
  'downloadPage.versionLabel': { zh: '版本', en: 'Version' },
  'downloadPage.dateLabel': { zh: '发布日期', en: 'Release date' },
  'downloadPage.architectureLabel': { zh: '架构', en: 'Architecture' },
  'downloadPage.sizeLabel': { zh: '安装包大小', en: 'Package size' },
  'downloadPage.architectureValue': { zh: 'Apple Silicon', en: 'Apple Silicon' },
  'downloadPage.unknown': { zh: '未提供', en: 'Unavailable' },
  'downloadPage.noRelease': { zh: '当前没有公开版本', en: 'No public release is available' },
  'downloadPage.noReleaseBody': { zh: 'GitHub Releases 中暂时没有可下载的 Apple Silicon 安装包。', en: 'There is no Apple Silicon package available in GitHub Releases yet.' },
  'downloadPage.noAsset': { zh: '该版本暂未提供 Apple Silicon 安装包', en: 'This release does not include an Apple Silicon package' },
  'downloadPage.downloadButton': { zh: '下载 Apple Silicon 版', en: 'Download for Apple Silicon' },
  'downloadPage.openRelease': { zh: '查看发布页面', en: 'View release page' },
  'downloadPage.installGuide': { zh: '查看安装说明', en: 'Read installation guide' },
  'downloadPage.updates': { zh: '查看更新记录', en: 'View release history' },
  'downloadPage.requirementsTitle': { zh: '开始前确认', en: 'Before you start' },
  'downloadPage.requirement1': { zh: '设备使用 M1、M2、M3、M4 或后续 Apple Silicon 芯片。', en: 'The Mac uses M1, M2, M3, M4, or a later Apple Silicon chip.' },
  'downloadPage.requirement2': { zh: '应用当前为未签名构建，首次打开需要在系统设置中确认。', en: 'The app is currently unsigned and may require confirmation in System Settings on first launch.' },
  'downloadPage.requirement3': { zh: '文档保存在本地目录，不要求登录，也不会上传到云端。', en: 'Documents stay in local folders. No sign-in or cloud upload is required.' },
  'downloadPage.notesTitle': { zh: '版本说明', en: 'Release notes' },
  'downloadPage.notesFallback': { zh: '该版本暂未填写更新说明。', en: 'No release notes were provided for this version.' },
  'downloadPage.originalNotes': { zh: '当前显示 GitHub 发布时的原始说明。', en: 'Showing the original notes published on GitHub.' },
};

let currentLanguage = 'zh';

function normalizeLanguage(value) {
  const normalized = String(value || '').toLowerCase();
  return normalized.startsWith('zh') ? 'zh' : 'en';
}

function interpolate(value, variables = {}) {
  return String(value).replace(/\{(\w+)\}/g, (_, key) => String(variables[key] ?? ''));
}

export function t(key, variables = {}) {
  const entry = MESSAGES[key];
  if (!entry) return key;
  return interpolate(entry[currentLanguage] || entry.zh, variables);
}

export function getLanguage() {
  return currentLanguage;
}

export function locale() {
  return currentLanguage === 'zh' ? 'zh-CN' : 'en-US';
}

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.dataset.i18n;
    const value = t(key);
    if (element.dataset.i18nHtml === 'true') {
      element.innerHTML = value;
    } else {
      element.textContent = value;
    }
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  });

  root.querySelectorAll('[data-i18n-value]').forEach(element => {
    element.value = t(element.dataset.i18nValue);
  });

  root.querySelectorAll('[data-i18n-title]').forEach(element => {
    element.setAttribute('title', t(element.dataset.i18nTitle));
  });

  root.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });

  document.querySelectorAll('[data-language]').forEach(button => {
    const active = button.dataset.language === currentLanguage;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

export function setLanguage(language, { persist = true, notify = true, updateUrl = true } = {}) {
  currentLanguage = normalizeLanguage(language);
  document.documentElement.lang = currentLanguage === 'zh' ? 'zh-CN' : 'en';

  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, currentLanguage);
    } catch (error) {
      // Storage can be unavailable in private browsing or file previews.
    }
  }

  const page = document.body?.dataset.page || 'home';
  const titleKey = page === 'docs'
    ? 'docs.metaTitle'
    : page === 'updates'
      ? 'updates.metaTitle'
      : page === 'install'
        ? 'install.metaTitle'
        : page === 'download'
          ? 'downloadPage.metaTitle'
        : 'meta.title';
  const descriptionKey = page === 'docs'
    ? 'docs.metaDescription'
    : page === 'updates'
      ? 'updates.metaDescription'
      : page === 'install'
        ? 'install.metaDescription'
        : page === 'download'
          ? 'downloadPage.metaDescription'
        : 'meta.description';
  document.title = t(titleKey);
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', t(descriptionKey));
  const socialMeta = [
    ['meta[property="og:title"]', 'content', t(titleKey)],
    ['meta[property="og:description"]', 'content', t(descriptionKey)],
    ['meta[property="og:locale"]', 'content', currentLanguage === 'zh' ? 'zh_CN' : 'en_US'],
    ['meta[name="twitter:title"]', 'content', t(titleKey)],
    ['meta[name="twitter:description"]', 'content', t(descriptionKey)],
  ];
  socialMeta.forEach(([selector, attribute, value]) => {
    const element = document.querySelector(selector);
    if (element) element.setAttribute(attribute, value);
  });
  applyTranslations();

  if (updateUrl && window.history?.replaceState) {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', currentLanguage === 'zh' ? 'zh-CN' : 'en');
    window.history.replaceState({}, '', url);
  }

  if (notify) {
    window.dispatchEvent(new CustomEvent('site-language-change', {
      detail: { language: currentLanguage },
    }));
  }
}

export function initI18n() {
  const requested = new URLSearchParams(window.location.search).get('lang');
  let saved = '';
  try {
    saved = localStorage.getItem(STORAGE_KEY) || '';
  } catch (error) {
    saved = '';
  }

  const initial = requested
    ? normalizeLanguage(requested)
    : saved
    ? normalizeLanguage(saved)
    : normalizeLanguage(navigator.language);

  document.querySelectorAll('[data-language]').forEach(button => {
    button.addEventListener('click', () => {
      setLanguage(button.dataset.language);
    });
  });

  setLanguage(initial, { persist: false, updateUrl: false });
  return currentLanguage;
}

export { MESSAGES, normalizeLanguage };
