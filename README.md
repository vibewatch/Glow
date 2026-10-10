# 霁光 PRO · 风光摄影机会工作台

霁光把风光摄影计划收敛成三个共享地点、日期和数据上下文的工作区：先看每日可拍什么，再检查云雨风，最后规划罕见天象。它不再要求用户在霞光、雾、太阳、月亮等十个孤立工具之间来回切换。

网站地址：[https://glow.genisisiq.com](https://glow.genisisiq.com)。代码仓库：[vibewatch/Glow](https://github.com/vibewatch/Glow)。

应用完全在浏览器运行，无后端、数据库或私有 API 密钥。Next.js 只负责构建静态页面；天气数据直接从 Open-Meteo 与 NOAA 获取，摄影评分和天文几何在浏览器计算。

## 三个工作区

### 每日拍摄机会

默认界面一次列出所选日期的 9 个独立窗口，并按峰值时刻排序：

- 朝霞与晚霞分别评分，在日出日落前后每 2 分钟计算太阳高度、中高云何时进入地影，并沿太阳方位 40–350 km 取 4 个格点判断光路透光，给出分钟级峰值与高指数窗口；云底高度按气候平均估计，因此仍不承诺目标云必然被照亮。
- 日出、日落、金色时段与蓝调使用确定性天文几何，不伪装成概率。
- 雾景、月亮、星空使用 ECMWF、CMA、GFS 与 ICON 多模式集合、时效和数据完整度形成机会指数。
- 彩虹同时检查降水、直射阳光、太阳高度和反太阳观察方向，并明确单点网格不知道雨幕空间位置。
- 极光通过独立的浏览器请求接入 NOAA SWPC Kp 预报；结合本地纬度经验门槛、天文黑夜与云量。数据源故障或超出有效期时显示“暂无可靠预测”，不会补成 0 分。

地图底部由两层时间控件组成：7 日日期选择和所选日 00:00–24:00 时间轴。点击右侧机会、时间轴峰值节点或拖动 15 分钟时间游标会更新当前时刻；地图只完整绘制当前选中机会的真实方位，雾和普通星空等没有可靠单一方向的项目不会制造箭头。辅助线长度不表示距离。

### 天气工作台

天气工作区采用常见天气 App 的决策顺序：

- 当前/所选小时的天气现象、温度、日高低温。
- 可横向选择的 24 小时天气预报和共享小时游标。
- 7 日日期选择。
- 云层：总云量、低/中/高云垂直结构与 24 小时趋势。
- 降雨：概率、小时量、连续性雨、阵雨和 WMO 天气现象。
- 风况：持续风、阵风、来风方向、脚架风险与 24 小时趋势。

现有天气响应是所选坐标的单点 168 小时预报。没有接入授权的雷达或网格瓦片前，地图只显示点位状态和来风方向，不把单点数据插值成虚假的全国云图、雨图或风场。

### 天象事件

天象事件按日期统一列出：

- 下一次本地可见月食和日食，包括开始、食甚、结束、遮掩、高度和方位。
- 未来 8 个主要流星雨事件，包括活跃期、峰值夜范围、理想天顶流量 ZHR、辐射点、本地峰值夜高度/方位和月面照明。
- 事件进入七天天气窗口后才附加云、雨、风现场条件；远期只显示天文几何，不生成伪天气分数。
- 日食详情始终显示太阳滤镜安全提示。

流星雨峰值采用“夜间范围”精度。ZHR 是理想暗空、辐射点在天顶等条件下的理论口径，不代表现场每小时一定能看到的数量。

## 数据来源与可信度

- ECMWF IFS、CMA GRAPES、NOAA GFS 与 DWD ICON 逐模式独立形成天气判断；模式分歧、预报提前量和缺失字段会降低参考度。多中心一致性不是集合预报概率。
- CAMS 提供气溶胶光学厚度与 PM₂.₅。
- Open-Meteo 是统一 HTTPS API 交付层，不是中国官方预警机构。此静态版本使用限流的非商业开放端点；商业部署需要另行确认授权方案，不能把私有 customer API 密钥放入浏览器。
- NOAA SWPC 提供 Kp 空间天气指导。Kp 是全球地磁活动指标，不等于某地点一定能看见极光；当前尚未接入实时极光椭圆和太阳风 Bz。
- Astronomy Engine 计算日月位置、暮光与食象；主要流星雨目录采用 IMO 年表口径并诚实表达峰值精度。
- 山体、建筑、光污染、局地云、雷达实况和精细地形仍需临近或现场复核。灾害天气以[中国气象局预警](https://weather.cma.cn/web/alarm/map.html)为准。

所有 0–100 摄影数值均称为“机会指数”，不是统计校准后的成功概率。霞光指数用太阳高度匹配经验暮光窗口，并把近地湿度、能见度和气溶胶限制为背景修正；单点预报仍无法证明目标云被直射、远处向阳光路畅通、云体光学厚度合适或地形无遮挡。云量、天气信号、食象遮掩和天文几何使用各自明确单位，不再压成一个含义混乱的分数。

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`。地图由 MapLibre GL 渲染，默认使用 OpenFreeMap（OpenMapTiles / OpenStreetMap）矢量底图并切换为中文地名，瓦片 worker 由 `scripts/copy-maplibre-worker.mjs` 在 `dev`/`build` 前复制到 `public/maplibre/` 同源提供；可通过 `NEXT_PUBLIC_MAP_STYLE_URL` 更换 MapLibre 样式。

## 静态部署与 GitHub Pages

```bash
npm run build
npm run start
```

`build` 导出 `out/`，并按页面内容生成 CSP 脚本 SHA-256 哈希；`start` 只是本地静态文件预览，不提供天气 API。可将 `out/` 原样发布到任意静态 HTTPS 主机。

`.github/workflows/pages.yml` 在 `main` 更新时运行完整验证并部署到 GitHub Pages。仓库 Pages 的构建来源应为 GitHub Actions；`public/CNAME` 指定 `glow.genisisiq.com`，DNS CNAME 指向 `vibewatch.github.io`，Pages 设置启用强制 HTTPS。

每个地点首次加载最多发起 9 个 Open-Meteo 请求（4 个天气模式、4 个多点光路请求、1 个 CAMS 请求），每个请求最多重试一次。页面内最多缓存 20 个地点、有效期 10 分钟；中国时间跨日失效，手动刷新绕过缓存，新落点取消旧请求。NOAA 单独缓存 15 分钟，源故障明确降级并在 2 分钟后允许重试。缓存只保存在当前页面内存，不存储用户数据，不共享配额，也不提供离线天气。

上游必须允许跨域浏览器访问；Open-Meteo 天气、空气质量和 NOAA 当前均支持 CORS。网络封锁、源限流或 CORS 策略变化会触发界面的不可用提示，不会回退到未授权代理或虚构数据。浏览器请求会向数据源发送所选经纬度，数据源可看到访问者 IP。

静态页面通过 CSP meta 限制脚本、对象和内联事件处理器；不使用运行时 nonce。GitHub Pages 控制 HTTP 响应头，不能沿用服务器版的自定义 HSTS、COOP、Permissions-Policy 或防嵌入响应头。更改导出 HTML 后必须重新生成 CSP 哈希。

## 验证

```bash
npm run verify
```

验证链路包括 ESLint、TypeScript、气象/天文/空间天气/浏览器数据边界单元测试、静态生产构建和 22 个 Playwright 流程。浏览器测试在静态文件服务器上拦截上游公开接口并返回确定性原始数据，仍由真实浏览器运行全部计算，不依赖本地 API。覆盖三个工作区、9 个每日机会、云/雨/风、24 小时与 7 日选择、三向机会联动、日月食与流星雨、极光降级、搜索/定位/地图落点/拖动/刷新/错误恢复、哈希 CSP 和 320×568 至 1920×1080 的 8 个视口。

UI 审计生成 82 张状态截图，并以 14 次 Axe 扫描覆盖三个工作区、天气详情、搜索、错误和 404 状态。`npm run verify:audit` 会交叉核对工作区注册表、Playwright 结果和截图矩阵，防止一个绿色退出码掩盖覆盖缺口。

## 主要结构

- `components/glow-dashboard.tsx`：共享地点、日期、加载状态、三工作区导航和地图外壳。
- `components/opportunity-workspace.tsx`：每日议程、机会详情和 24 小时时间轴。
- `components/weather-workspace.tsx`：逐小时天气与云/雨/风详情。
- `components/events-workspace.tsx`：食象和流星雨事件日历。
- `components/weather-map.tsx`：MapLibre 生命周期、可拖动观测点和单一选中方位标注。
- `lib/opportunities.ts`：把摄影模型、天文几何、彩虹和极光适配成统一每日机会。
- `lib/space-weather.ts`：NOAA SWPC Kp 适配、验证、重试与独立降级。
- `lib/meteor-showers.ts`：主要流星雨年表、本地辐射点和月光条件。
- `lib/weather.ts`：多模式 168 小时天气、摄影模型和单模式降级。
- `lib/browser-data.ts`：中国区域校验、有限内存缓存、请求取消和独立空间天气降级。
- `lib/astronomy.ts`：太阳、月亮、暮光与本地可见食象。

详细边界见 [`docs/data-research.md`](docs/data-research.md)、[`docs/weather-tools-architecture.md`](docs/weather-tools-architecture.md) 和 [`docs/professional-photography-audit.md`](docs/professional-photography-audit.md)。
