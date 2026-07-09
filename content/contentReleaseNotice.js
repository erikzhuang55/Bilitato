// content/contentReleaseNotice.js

(function () {
  const STORAGE_KEY = "bilitato_last_seen_version";

  const RELEASE_NOTES = {
    "1.4.3": {
      title: "Bilitato 已更新至 v1.4.3",
      displayVersion: "v1.4.3",
      subtitle: "这版继续打磨侧边栏和更新体验：切回内嵌面板更稳定，缓存管理更清楚，也能在有新版可用时更早提醒你。",
      groups: [
        {
          tag: "新增",
          items: [
            {
              title: "新增可用版本更新提醒",
              desc: "当插件检测到有新版本可用时，会在标题旁显示小提示，点击即可打开浏览器扩展管理页进行更新。",
              highlight: true,
            },
          ],
        },
        {
          tag: "修复",
          items: [
            {
              title: "修复侧边栏切回内嵌偶发无效",
              desc: "修复点击切回内嵌面板后，侧边栏关闭了但页面仍保持侧边栏状态的问题。",
              highlight: true,
            },
            {
              title: "修复更新导览显示细节",
              desc: "更新导览弹层现在不会再被页面右上角按钮干扰，阅读更新内容更干净。",
            },
          ],
        },
        {
          tag: "优化",
          items: [
            {
              title: "优化缓存管理区域",
              desc: "缓存删除和云端缓存拉取开关的排版更舒展，宽侧边栏里不再显得拥挤。",
            },
            {
              title: "补充测试入口",
              desc: "测试页新增可用版本更新入口，方便确认更新提示和跳转是否正常。",
            },
          ],
        },
      ],
      privacy: "本插件不会上传任何 API Key、Prompt 或您和 AI 的聊天内容。版本检查只读取插件最新版本号，不包含视频内容、字幕、聊天或个人配置。",
    },
    "1.4.2": {
      title: "Bilitato 已更新至 v1.4.2",
      displayVersion: "v1.4.2",
      subtitle: "这版重点补上浏览器侧边栏、缓存管理和一批细节体验修复，让看视频时的操作更稳定、更顺手。",
      groups: [
        {
          tag: "新增",
          items: [
            {
              title: "新增浏览器侧边栏模式",
              desc: "可以把 Bilitato 打开到浏览器侧边栏里使用，字幕、总结、聊天、验真和设置都能在更宽的空间里操作。",
              highlight: true,
            },
            {
              title: "新增本地缓存清理",
              desc: "设置页现在可以删除当前视频缓存，也可以一键清空所有视频缓存，误点前会先二次确认。",
            },
          ],
        },
        {
          tag: "修复",
          items: [
            {
              title: "修复侧边栏体验不一致",
              desc: "侧边栏的字幕、总结、聊天、验真和设置样式进一步对齐内嵌面板，复制、下载、提示气泡和滚动表现更一致。",
              highlight: true,
            },
            {
              title: "修复聊天和总结滚动异常",
              desc: "修复流式输出时页面跳到顶部、切换新视频后聊天引导缺失、复制后无反馈等问题。",
            },
            {
              title: "修复下载兼容问题",
              desc: "针对部分浏览器直接下载 B 站音视频时的跨域失败，改为更兼容的下载链路。",
            },
          ],
        },
        {
          tag: "优化",
          items: [
            {
              title: "更新 ModelScope 模型选项",
              desc: "根据 ModelScope 当前可直接调用的模型范围更新默认选项，并补充更清晰的额度提示。",
            },
            {
              title: "优化侧边栏与内嵌面板切换",
              desc: "打开侧边栏后自动隐藏内嵌面板，切回内嵌时再恢复，页面不再同时出现两套入口。",
            },
          ],
        },
      ],
      privacy: "本插件不会上传任何 API Key、Prompt 或您和 AI 的聊天内容。本地缓存清理只会删除浏览器本机保存的视频缓存，不会删除您的 B 站数据。",
    },
    "1.4.1": {
      title: "Bilitato 已更新至 v1.4.1",
      displayVersion: "v1.4.1",
      subtitle: "本次重点升级原生字幕接管、错误面板、反馈中心与使用数据打点，集中优化默认开字幕暴露、限流提示过轻、反馈服务误伤主流程和模型选择范围不够的问题。",
      groups: [
        {
          tag: "新增",
          items: [
            {
              title: "新增小米 MiMo Provider",
              desc: "设置页现在支持直接选择小米 MiMo，并内置常用模型候选项，扩充了可用模型池。",
              highlight: true,
            },
          ],
        },
        {
          tag: "修复",
          items: [
            {
              title: "修复 B 站原生字幕默认露出和黑框残留",
              desc: "针对 B 站字幕懒加载，改为自动触发后只做无感隐藏，并在用户手动碰字幕按钮时立刻恢复，避免按钮卡死、黑框残留和字幕露出。",
              highlight: true,
            },
            {
              title: "修复合集/分 P 切换时字幕串线",
              desc: "字幕抓取改为按 `bvid + p` 路由识别，切换合集或分 P 时会更准确地重置状态，减少把上一个视频字幕带到当前视频的问题。",
            },
            {
              title: "修复反馈服务异常误导感",
              desc: "反馈中心不可用时继续按非阻塞方式降级，只影响反馈入口，不再给人主功能也会受影响的感觉。",
            },
          ],
        },
        {
          tag: "优化",
          items: [
            {
              title: "429 / 5XX 改为面板提示",
              desc: "高频限流和服务异常不再只弹 Toast，而是进入面板卡片，并统一补上重试按钮。",
            },
            {
              title: "细化 402 / 429 错误文案",
              desc: "现在会区分余额不足、模型不可用、配额耗尽、频率限制和队列拥堵，用户更容易知道该换模型、等一会儿还是去设置。",
            },
          ],
        },
      ],
      privacy: "本插件不会上传任何 API Key、Prompt 或您和 AI 的聊天内容。新增的使用行为上报仅记录任务状态、Provider、模型、耗时等统计字段，不包含聊天正文、Prompt 或字幕原文。",
    },
    "1.4.0": {
      title: "Bilitato 已更新至 v1.4.0",
      displayVersion: "v1.4.0",
      subtitle: "本次重点升级长音频转录、分段容错和转录稳定性，集中优化超大音轨转录、视频切换串线、按钮状态异常和错误提示不清的问题。",
      groups: [
        {
          tag: "新增",
          items: [
            {
              title: "长音频自动切片转录",
              desc: "超出服务限制的音轨现在会先自动切片，再分段转录，减少“音频过大无法转录”的情况。",
              highlight: true,
            },
            {
              title: "额度说明更清晰",
              desc: "Groq 和 ModelScope 常用模型的额度说明现在可以直接在设置页查看。",
            },
          ],
        },
        {
          tag: "修复",
          items: [
            {
              title: "修复字幕串到上一个视频",
              desc: "修复切换视频后偶发沿用旧音轨，导致字幕串线的问题。",
              highlight: true,
            },
            {
              title: "修复转录按钮和进度异常",
              desc: "修复按钮短暂释放、进度条中断后又恢复等问题，转录过程更稳定。",
            },
            {
              title: "修复分段生成易失败",
              desc: "修复分段 JSON、字段缺失、占位值等问题导致整体失败的情况。",
            },
          ],
        },
        {
          tag: "优化",
          items: [
            {
              title: "优化长音频转录体验",
              desc: "Groq 与硅基流动都补强了超限场景下的自动切片处理能力。",
            },
            {
              title: "优化错误提示",
              desc: "现在能更明确区分限流、切片失败、自动切片仍超限、时长识别失败等不同原因。",
            },
            {
              title: "优化设置页交互",
              desc: "下拉项说明提示的位置和展示方式更自然，不再容易被遮挡或裁切。",
            },
          ],
        },
      ],
      privacy: "本插件不会上传任何 API Key、Prompt 或您和 AI 的聊天内容。长音频切片与合并在本地完成，仅在实际调用您选择的转录服务时上传必要音频内容。",
    },
    "1.3.x": {
      title: "Bilitato v1.3 系列更新回顾",
      displayVersion: "v1.3.1 - v1.3.0",
      subtitle: "v1.3 系列的更新总结。",
      groups: [
        {
          tag: "v1.3.1",
          sections: [
            {
              tag: "新增",
              items: [
                {
                  title: "错误提示更具体",
                  desc: "细分了超时、Provider 网络失败、模型无权限、阿里云未实名、模型 ID 无效等前端错误提示，并统一补上刷新或重试入口。",
                },
              ],
            },
            {
              tag: "修复",
              items: [
                {
                  title: "修复总结与分段状态不同步",
                  desc: "修复总结已完成但分段偶发被旧缓存覆盖成空数组，导致页面误显示尚未生成分段的问题。",
                  highlight: true,
                },
                {
                  title: "修复提示词被切换重置",
                  desc: "修复切换 Groq、硅基流动或主 Provider 时，个性化里的自定义提示词被回填成默认值的问题。",
                },
                {
                  title: "修复本地缓存与配额问题",
                  desc: "增加 unlimitedStorage 和本地缓存兜底，避免字幕缓存过大时反复触发 QUOTA_BYTES 上报。",
                },
              ],
            },
            {
              tag: "优化",
              items: [
                {
                  title: "Provider 网络失败无感重试",
                  desc: "普通模型请求遇到短暂网络波动时会自动短退避重试；流式请求仅在首包前失败时补重试一次，减少偶发生成失败。",
                },
                {
                  title: "分段空返回自动补救",
                  desc: "分段为空或格式跑偏时，会保留更完整诊断信息，并在合适场景自动尝试更紧凑的补救请求。",
                },
              ],
            },
          ],
        },
        {
          tag: "v1.3.0",
          sections: [
            {
              tag: "新增",
              items: [
                {
                  title: "反馈中心",
                  desc: "现在可以在插件内提交问题与建议，并查看处理状态和回复提醒。",
                },
                {
                  title: "更多 Provider 支持",
                  desc: "新增 OpenRouter 和 Claude 支持，完善 Gemini、OpenAI、DeepSeek、Kimi、智谱等模型候选项。",
                  highlight: true,
                },
              ],
            },
            {
              tag: "优化",
              items: [
                {
                  title: "模型设置更好用",
                  desc: "不同 Provider 会分别记忆 API Key 和模型选择，自定义 Provider 支持自动授权域名。",
                },
                {
                  title: "免费额度提示",
                  desc: "ModelScope、Gemini、OpenRouter 增加免费额度标记，悬停即可查看 RPM、RPD 等限额信息。",
                },
                {
                  title: "多模型兼容更稳定",
                  desc: "优化 OpenRouter、Gemini、Claude、自定义 API 等流式返回解析，减少总结为空和生成失败。",
                  highlight: true,
                },
              ],
            },
            {
              tag: "修复",
              items: [
                {
                  title: "修复字幕缓存读取",
                  desc: "修复本地/云端字幕已存在时，聊天、总结、验真偶发提示暂无字幕的问题。",
                },
                {
                  title: "修复转录状态异常",
                  desc: "修复在线转录按钮闪烁、进度回退、下载后短暂误显示无字幕等问题。",
                },
                {
                  title: "修复聊天体验问题",
                  desc: "修复聊天报错后页面置底、无字幕状态误上报异常、输入空格和输入法异常等问题。",
                },
              ],
            },
          ],
        },
      ],
      privacy: "本插件不会上传任何 API Key、Prompt 或您和 AI 的聊天内容。反馈中心仅在您主动提交时上传问题内容和必要异常日志。",
    },
    "1.2.x": {
      title: "Bilitato v1.2 系列更新回顾",
      displayVersion: "v1.2.3 - v1.2.0",
      subtitle: "v1.2 系列的更新总结。",
      groups: [
        {
          tag: "v1.2.3",
          sections: [
            {
              tag: "优化",
              items: [
                {
                  title: "字幕缓存更稳定",
                  desc: "CC、总结、聊天、验真都会主动读取云端字幕；云端已有字幕时会直接加载，减少重复转录。",
                },
                {
                  title: "分段和广告识别更准确",
                  desc: "优化分段边界和广告识别逻辑，减少错分、漏分和时间点偏移，长视频结构更清晰。",
                },
              ],
            },
            {
              tag: "修复",
              items: [
                {
                  title: "修复字幕状态不同步",
                  desc: "修复转录完成后总结仍显示暂无字幕、刷新无反应，以及页面未及时刷新字幕的问题。",
                },
                {
                  title: "修复总结与验真异常",
                  desc: "修复无 API Key 时总结页空白、验真读取转录字幕报错、已有字幕却提示无字幕等问题。",
                },
              ],
            },
          ],
        },
        {
          tag: "v1.2.2",
          sections: [
            {
              tag: "新增",
              items: [
                {
                  title: "新手引导预览",
                  desc: "新增第三步预览效果，无需先配置 API Key，也能查看已有云端缓存的视频总结。",
                },
              ],
            },
            {
              tag: "优化",
              items: [
                {
                  title: "高速/省流模式",
                  desc: "默认使用高速模式，总结支持流式展示；省流模式保留 1 次调用生成总结和分段。",
                },
                {
                  title: "设置与缓存提示",
                  desc: "设置页改为自动保存提示，API Key 可显示明文并自动清理首尾空格，云端缓存会提示不消耗调用次数。",
                },
              ],
            },
          ],
        },
        {
          tag: "v1.2.1",
          sections: [
            {
              tag: "优化",
              items: [
                {
                  title: "转录与按钮反馈",
                  desc: "点击转录后会立即进入检查/转录状态，按钮同步禁用，减少卡顿感和重复点击。",
                },
              ],
            },
            {
              tag: "修复",
              items: [
                {
                  title: "修复聊天输入问题",
                  desc: "修复聊天框无法输入空格、中文输入法可能被打断，以及报错后页面强制滚到底部的问题。",
                },
                {
                  title: "修复转录状态异常",
                  desc: "修复在线转录按钮闪烁、进度回退、下载后短暂误显示无字幕等问题。",
                },
              ],
            },
          ],
        },
        {
          tag: "v1.2.0",
          sections: [
            {
              tag: "新增",
              items: [
                {
                  title: "SiliconFlow 转录支持",
                  desc: "支持无需翻墙的 FunAudioLLM/SenseVoiceSmall 大模型（无法生成时间戳，但不影响总结）。",
                },
              ],
            },
            {
              tag: "优化",
              items: [
                {
                  title: "视频/音频下载更稳定",
                  desc: "重做下载方式，减少 403、下载失败、下载成网页文件等问题。",
                },
              ],
            },
            {
              tag: "修复",
              items: [
                {
                  title: "音频转录修复",
                  desc: "修复无字幕视频音频转录可能会出现字幕串线的问题。",
                },
              ],
            },
          ],
        },
      ],
      privacy: "本插件不会上传任何 API Key、Prompt 或您和 AI 的聊天内容。",
    },
    "1.2.3": {
      title: "Bilitato 已更新至 v1.2.3",
      displayVersion: "v1.2.1 - v1.2.3",
      subtitle: "本次合并了近期多版更新，重点优化新手引导、转录、字幕缓存、总结、分段、聊天和验真体验。",
      groups: [
        {
          tag: "新增",
          items: [
            {
              title: "新手引导预览",
              desc: "新增第三步预览效果，无需先配置 API Key，也能查看已有云端缓存的视频总结。",
            },
          ],
        },
        {
          tag: "优化",
          items: [
            {
              title: "高速/省流模式",
              desc: "默认使用高速模式，总结支持流式展示；省流模式保留 1 次调用生成总结和分段。",
            },
            {
              title: "设置与缓存提示",
              desc: "设置页改为自动保存提示，API Key 可显示明文并自动清理首尾空格，云端缓存会提示不消耗调用次数。",
            },
            {
              title: "云端字幕缓存更稳定",
              desc: "CC、总结、聊天、验真都会主动读取云端字幕；云端已有字幕时会直接加载，减少重复转录。",
            },
            {
              title: "在线转录反馈更及时",
              desc: "点击转录后会立即进入检查/转录状态，按钮同步禁用，避免卡顿感和重复点击。",
            },
            {
              title: "分段和广告识别更准确",
              desc: "优化分段边界和广告识别逻辑，减少错分、漏分和时间点偏移，长视频结构更清晰。",
            },
          ],
        },
        {
          tag: "修复",
          items: [
            {
              title: "修复字幕状态不同步",
              desc: "修复转录完成后总结仍显示暂无字幕、刷新无反应，以及页面未及时刷新字幕的问题。",
            },
            {
              title: "修复聊天输入问题",
              desc: "修复聊天框无法输入空格、中文输入法可能被打断，以及报错后页面强制滚到底部的问题。",
            },
            {
              title: "修复总结与验真异常",
              desc: "修复无 API Key 时总结页空白、验真读取转录字幕报错、已有字幕却提示无字幕等问题。",
            },
          ],
        },
      ],
      privacy: "本插件不会上传任何 API Key、Prompt 或您和 AI 的聊天内容。",
    },
    "1.2.0": {
      title: "Bilitato 已更新至 v1.2.0",
      displayVersion: "v1.2.0",
      subtitle: "本次重点优化转录、下载与稳定性。",
      groups: [
        {
          tag: "新增",
          items: [
            {
              title: "SiliconFlow 转录支持",
              desc: "支持无需翻墙的 FunAudioLLM/SenseVoiceSmall 大模型（无法生成时间戳，但不影响总结）。",
            },
          ],
        },
        {
          tag: "优化",
          items: [
            {
              title: "视频/音频下载更稳定",
              desc: "重做下载方式，减少 403、下载失败、下载成网页文件等问题。",
            },
          ],
        },
        {
          tag: "修复",
          items: [
            {
              title: "音频转录修复",
              desc: "修复无字幕视频音频转录可能会出现字幕串线的问题。",
            },
          ],
        },
      ],
      privacy: "本插件不会上传任何 API Key、Prompt 或您和 AI 的聊天内容。",
    },
  };

  function getCurrentVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return "";
    }
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result?.[key]);
      });
    });
  }

  function storageSet(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function shouldShowReleaseNotice(version = getCurrentVersion()) {
    if (!version || !RELEASE_NOTES[version]) return false;

    const lastSeenVersion = await storageGet(STORAGE_KEY);
    return lastSeenVersion !== version;
  }

  async function markReleaseNoticeSeen(version = getCurrentVersion()) {
    if (!version) return;

    await storageSet({
      [STORAGE_KEY]: version,
    });
  }

  function renderReleaseNotice({ root, version = getCurrentVersion() }) {
    if (!root) return false;

    const note = RELEASE_NOTES[version];
    if (!note) return false;
    const pageVersions = buildReleasePageVersions(version);

    const box = root.querySelector(".ai-summary-plugin-box");
    if (!box) return false;

    box.querySelector(".release-notice-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "release-notice-overlay";

    overlay.innerHTML = `
      <div class="release-notice-card" role="dialog" aria-modal="true">
        <button class="release-notice-close" type="button" title="关闭">×</button>
        <div class="release-notice-content"></div>
        <div class="release-notice-pager"></div>
        <div class="release-notice-actions">
          <button class="release-notice-secondary" type="button">
            稍后再看
          </button>
          <button class="release-notice-primary" type="button">
            我知道了
          </button>
        </div>
      </div>
    `;

    let pageIndex = 0;
    const normalizeGroups = (pageNote) => {
      if (Array.isArray(pageNote?.groups)) return pageNote.groups;
      const buckets = [];
      (Array.isArray(pageNote?.highlights) ? pageNote.highlights : []).forEach((item) => {
        const tag = String(item?.tag || "优化");
        let group = buckets.find((entry) => entry.tag === tag);
        if (!group) {
          group = { tag, items: [] };
          buckets.push(group);
        }
        group.items.push({ title: item.title, desc: item.desc });
      });
      return buckets;
    };

    const renderPage = () => {
      const pageVersion = pageVersions[pageIndex] || version;
      const pageNote = RELEASE_NOTES[pageVersion] || note;
      const displayVersion = pageNote.displayVersion || `v${pageVersion}`;
      const groups = normalizeGroups(pageNote);
      const content = overlay.querySelector(".release-notice-content");
      const pager = overlay.querySelector(".release-notice-pager");
      if (content) {
        content.innerHTML = `
          <div class="release-notice-fixed-head">
            <div class="release-notice-top">
              <span class="release-notice-badge">更新说明</span>
              <span class="release-notice-version">${escapeHtml(displayVersion)}</span>
            </div>

            <div class="release-notice-title">${escapeHtml(pageNote.title)}</div>
            <div class="release-notice-subtitle">${escapeHtml(pageNote.subtitle)}</div>
          </div>

          <div class="release-notice-scroll-body">
            <div class="release-notice-group-list">
              ${groups
              .map(
                (group) => `
                  <section class="release-notice-group">
                    <div class="release-notice-group-tag">${escapeHtml(group.tag)}</div>
                    ${Array.isArray(group.sections) ? `
                      <div class="release-notice-section-list">
                        ${group.sections
                          .map(
                            (section) => `
                              <div class="release-notice-section">
                                <div class="release-notice-section-tag">${escapeHtml(section.tag)}</div>
                                <div class="release-notice-group-items">
                                  ${(Array.isArray(section.items) ? section.items : [])
                                    .map(
                                      (item) => `
                                        <div class="release-notice-item${item.highlight ? " release-notice-item-highlight" : ""}">
                                          <div class="release-notice-item-title">${escapeHtml(item.title)}</div>
                                          <div class="release-notice-item-desc">${escapeHtml(item.desc)}</div>
                                        </div>
                                      `
                                    )
                                    .join("")}
                                </div>
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                    ` : `
                      <div class="release-notice-group-items">
                        ${(Array.isArray(group.items) ? group.items : [])
                        .map(
                          (item) => `
                            <div class="release-notice-item${item.highlight ? " release-notice-item-highlight" : ""}">
                              <div class="release-notice-item-title">${escapeHtml(item.title)}</div>
                              <div class="release-notice-item-desc">${escapeHtml(item.desc)}</div>
                            </div>
                          `
                        )
                        .join("")}
                      </div>
                    `}
                  </section>
                `
              )
              .join("")}
            </div>

            <div class="release-notice-privacy">
              ${escapeHtml(pageNote.privacy)}
            </div>
          </div>
        `;
      }
      if (pager) {
        pager.innerHTML = pageVersions.length > 1 ? `
          <button class="release-notice-page-btn" type="button" data-release-page="prev" ${pageIndex === 0 ? "disabled" : ""}>上一页</button>
          <span class="release-notice-page-count">${pageIndex + 1} / ${pageVersions.length}</span>
          <button class="release-notice-page-btn" type="button" data-release-page="next" ${pageIndex >= pageVersions.length - 1 ? "disabled" : ""}>下一页</button>
        ` : "";
      }
    };
    renderPage();

    const closeAndMarkSeen = async () => {
      await markReleaseNoticeSeen(version);
      overlay.remove();
    };

    const closeOnly = () => {
      overlay.remove();
    };

    overlay
      .querySelector(".release-notice-close")
      ?.addEventListener("click", closeAndMarkSeen);

    overlay
      .querySelector(".release-notice-primary")
      ?.addEventListener("click", closeAndMarkSeen);

    overlay
      .querySelector(".release-notice-secondary")
      ?.addEventListener("click", closeOnly);

    overlay.addEventListener("click", (event) => {
      const pageButton = event.target.closest?.("[data-release-page]");
      if (!pageButton) return;
      const direction = pageButton.dataset.releasePage;
      if (direction === "prev") pageIndex = Math.max(0, pageIndex - 1);
      if (direction === "next") pageIndex = Math.min(pageVersions.length - 1, pageIndex + 1);
      renderPage();
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeOnly();
    });

    box.appendChild(overlay);
    return true;
  }

  function buildReleasePageVersions(version) {
    const majorHistory = [];
    if (version === "1.4.3") {
      majorHistory.push("1.4.3", "1.4.2", "1.4.1", "1.4.0", "1.3.x", "1.2.x");
    } else if (version === "1.4.2") {
      majorHistory.push("1.4.2", "1.4.1", "1.4.0", "1.3.x", "1.2.x");
    } else if (version === "1.4.1") {
      majorHistory.push("1.4.1", "1.4.0", "1.3.x", "1.2.x");
    } else if (version === "1.4.0") {
      majorHistory.push("1.4.0", "1.3.x", "1.2.x");
    } else if (version === "1.3.1" || version === "1.3.0" || version === "1.3.x") {
      majorHistory.push("1.3.x", "1.2.x");
    } else {
      majorHistory.push(version, "1.2.x");
    }
    return majorHistory.filter((item, index, arr) => item && RELEASE_NOTES[item] && arr.indexOf(item) === index);
  }

  async function maybeShowReleaseNotice({ root, version = getCurrentVersion() }) {
    const shouldShow = await shouldShowReleaseNotice(version);
    if (!shouldShow) return false;

    return renderReleaseNotice({ root, version });
  }

  globalThis.BilitatoReleaseNotice = {
    RELEASE_NOTES,
    shouldShowReleaseNotice,
    markReleaseNoticeSeen,
    renderReleaseNotice,
    maybeShowReleaseNotice,
  };
})();
