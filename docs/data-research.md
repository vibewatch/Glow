# 中国风光摄影气象与天文数据源调研

调研日期：2026-08-03

## 结论

不存在对所有地点、时效和天气过程都“最准确”的单一数据源。不同摄影场景需要不同变量：霞光依赖日出/日落前后的分层云；雾景依赖露点差、近地湿度、风和地形；日月升落需要天体地平坐标；食象首先是可长期计算的天文几何，只有临近七天才能叠加可信天气。可实施性、更新频率、授权和模式独立性同样重要。

霁光第一阶段选择：

1. ECMWF IFS（HRES 9 km 开放数据）作为全球大尺度天气基准。
2. CMA GRAPES 作为面向中国区域的独立模式。
3. CAMS 作为气溶胶光学厚度和颗粒物来源。
4. 通过 Open-Meteo 的统一接口接入并做 30 分钟服务端缓存，不把密钥暴露给浏览器。
5. 使用 Astronomy Engine 在服务端根据经纬度计算太阳/月亮位置及本地食象，不依赖静态事件表。
6. 使用 Open-Meteo 的 10 m 阵风字段补充脚架稳定性；该字段表示前一小时最大阵风，而不是瞬时持续风。
7. 使用独立的 NOAA SWPC planetary K-index forecast 提供约三日空间天气指导；源不可用时只降级极光，不影响普通天气。
8. 使用 IMO 主要流星雨年表口径建立版本化事件目录，并用 Astronomy Engine 计算定位点峰值夜的辐射点和月光条件。

Open-Meteo 的开放接口适合非商业使用、受公平调用限制，并要求按 CC BY 4.0 进行归属说明；正式商业上线需要 customer API 套餐，不能把“无需密钥”理解为“没有使用条款”。霁光配置 `OPEN_METEO_API_KEY` 后会同时切换天气与空气质量 customer 端点，避免商业部署仍误用开放主机。

这里的核心收益不是简单地把两个数字平均，而是用模式分歧表达不确定性。北京坐标的接口实测中，两套模式在同一时刻的低云和高云可以出现很大差异；单模式给出的高概率不应被展示成高置信结论。

## 候选源对比

| 数据源 | 适合的角色 | 优点 | 局限 / 接入条件 | 当前决策 |
| --- | --- | --- | --- | --- |
| ECMWF IFS | 全球中期数值预报 | 国际通用基准，大尺度环流和中期预报稳定；官方提供开放数据 | 开放数据与第三方接口的空间分辨率、变量范围可能不同；局地地形云仍有限 | 采用 |
| CMA GRAPES | 中国区域的独立数值模式 | 中国气象局体系，在中国具有区域相关性；可与 ECMWF 交叉验证 | 部分变量（如降水概率）可能缺失；需做好空值处理 | 采用 |
| CAMS | 大气成分 | 提供气溶胶光学厚度与 PM₂.₅ 预测，补足“霞光颜色”因素 | 空间分辨率不足以表达街区污染变化 | 采用 |
| 中国气象数据网 | 权威历史观测与科研数据 | 官方站点观测，适合未来做模型校准和回测 | 实时产品、账号、授权与 API 便利性需按产品确认 | 校准阶段 |
| 彩云天气 API | 中国临近天气与降水 | 官方文档宣称约 1 km 空间、1 分钟时间分辨率的临近降水能力，适合短临增强 | 需要账号、密钥、配额和商业授权；“降水高精度”不等于分层云量同样高精度 | 可插拔增强 |
| 和风天气 API | 成熟的中国城市天气产品 | 产品化程度高，城市与格点接口完善 | 需要 JWT/API Host、订阅及授权；仍需确认霞光所需分层云变量 | 备选产品源 |
| NOAA SWPC | 全球地磁活动与 Kp 指导 | 免费公开、更新频繁、适合判断近期地磁活动 | Kp 不是极光椭圆或地点可见性；中国大部分地区需要极端活动 | 采用，独立降级 |
| IMO 流星雨年表 | 主要流星雨活跃期与理想 ZHR 口径 | 事件定义和专业口径清晰 | 年度峰值会移动；ZHR 不等于现场可见数量 | 采用，峰值按夜间范围表达 |

## 模型边界

当前的 0–100% 是可解释的机会指数：霞光在日出日落前后每 2 分钟计算太阳高度与中高云受光几何，再结合分层云、降水、能见度、湿度和气溶胶背景评分；不会把整个时段平均成一个不存在的中间云况。小时降水量和降水概率按 Open-Meteo 的“前一小时”区间语义取覆盖候选时刻的区间，不做瞬时线性插值。各数值模式独立得分后求平均，并以多中心分歧、数据完整度和预报提前量生成参考度。该参考度不是 ECMWF 集合成员概率。月亮和星空也逐模式评估当晚候选小时；月亮强调月面高度、遮云、能见度、降水、结露和长焦稳定，星空强调太阳低于天文暮光阈值、月光干扰、三层云、结露和阵风。

霞光的必要物理条件是：太阳到目标云体的光路足够通透、目标云仍在地球阴影之上、云体具有适合散射的光学性质，而且观察者到云体的视线未被低云或地形挡住。当前实现把其中两项做成了显式几何：一是按太阳高度（含大气折射）每 2 分钟计算中云（按 4.5 km）与高云（按 9 km）何时进入地影、光色何时最红，从而给出分钟级峰值与高指数窗口；二是沿日出/日落方位 40、120、220、350 km 各取一个格点的分层云量，按照射到每层云的光线在该距离处的高度判断它穿过哪一层并计算透光率。仍然无法证明的部分：云底高度按气候平均估计而非模式输出，4 个格点分辨不出更细的云缝，观察者视线和地形遮挡不在模型内。因此“低云”仍只称为近地遮挡信号；近地相对湿度不作为正向成因，AOD 只做弱的非单调背景修正。

雾景指数目前是摄影规划筛选器，不是严格的平流雾分类器：它用露点差、湿度、风速、低云、能见度和非降水信号寻找每天最佳窗口，但没有精细 DEM、坡向、水温、海陆温差和水面距离。因此产品会展示“雾景潜势”并保留该限制，而不是给出虚假的确定性结论。

天文部分与天气部分必须分开理解：太阳/月亮方位和食象时刻属于可长期计算的几何结果；几年后的日食可以准确列出，但当时的云量无法提前几年预报。界面会把食象显示为一个事件，并明确标注它是否进入七天天气窗口，不把长期食象遮掩率复制成七个天气日分数。

极光也不能当作普通七日天气。NOAA Kp 只覆盖近期地磁活动；产品会把有效期之外的日期标成“暂无可靠预测”。当前本地机会用 Kp、纬度经验门槛、天文黑夜和云量联合筛选，但没有实时极光椭圆与太阳风 Bz，因此不会承诺具体地点可见。

流星雨事件的活跃期和辐射点可长期规划，但年度峰值通常只能合理表达为一个夜间范围。ZHR 是理想暗空、辐射点位于天顶等标准条件下的理论流量；界面会同时给出本地辐射点高度、月光干扰和天气是否已进入七日窗口，不把 ZHR 写成用户现场每小时必见数量。

星空指数目前仍是“气象与天文黑夜机会”。它没有把 VIIRS 夜光、Bortle 等级、DEM 地形地平线、银河核心位置和前景照明加入模型，因此不能承诺暗空质量或构图成立。相关采购、许可和实现决策见专业审查文档。

它还不是“在 100 次相同条件下有 72 次看到晚霞”这种经样本校准的统计概率。要达到这个层级，需要：

- 收集带时间、经纬度、视向和遮挡信息的日出日落实拍标签；
- 将卫星云图、地形地平线与站点实况加入特征；
- 按地区、季节、提前时效分别做可靠性曲线和 Brier Score 回测；
- 对分数做 isotonic regression 或 Platt scaling 等概率校准；
- 定期检查不同模式版本升级造成的数据漂移。

太阳方位多点采样已经实现（见上文）。下一阶段的最高收益不是继续手调权重，而是把观察者视线与 DEM 地平线分开判断；随后接入 ECMWF 集合成员逐成员评分，报告中位数、分位数和有利成员比例。真正的物理亮度预测还需要区域三维云水/冰水、云顶云底、光学厚度、DEM 地平线与卫星临近云产品。

## 云、雨和彩虹字段语义

新增天气工具继续使用同一份 168 小时响应，不额外调用一个来源不明的“彩虹 API”。天气端点要求总云量、低/中/高云量、`precipitation_probability`、`precipitation`、`rain`、`showers`、WMO `weather_code` 与 `direct_radiation` 数组完整返回；缺少必需字段的提供方响应会在服务端被拒绝，而不是用零静默填充。

- 云层分数是所选日的峰值总云量百分比；三层云用于解释垂直结构，不把高云或低云主观等同于拍摄质量。
- 降雨工具保留 Open-Meteo/ECMWF 的降水概率，但 CMA GRAPES 当前没有该字段。CMA 空值不会被伪造；明确的 mm/h 降水量会贡献一个 0–100 综合降水信号，界面仍单独展示实际雨量。
- 彩虹潜势要求同一网格小时内出现降水或阵雨、直射辐射，以及高于地平线且低于约 42° 的太阳。太阳方位由 Astronomy Engine 按坐标和小时计算，建议观察方向取反太阳方位。
- 点位数值模式无法判断雨幕在观察者的哪一侧，也无法验证局地遮挡、光学厚度或肉眼可见性。因此彩虹输入置信上限为 70，结果不能称为确定性预报。

这些字段是模式指导，不是站点实况或雷达临近监测。对流、暴雨和灾害风险必须转到[中国气象局气象灾害预警](https://weather.cma.cn/web/alarm/map.html)复核。

## 官方与产品文档

- [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data)
- [ECMWF Forecast User Guide](https://www.ecmwf.int/en/forecasts/documentation-and-support)
- [中国气象数据网](https://data.cma.cn/en)
- [Copernicus Atmosphere Monitoring Service](https://atmosphere.copernicus.eu/)
- [Open-Meteo Weather Forecast API](https://open-meteo.com/en/docs)
- [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api)
- [Open-Meteo licence](https://open-meteo.com/en/licence)
- [Open-Meteo pricing and commercial-use terms](https://open-meteo.com/en/pricing)
- [WMO International Cloud Atlas — cloud optical thickness](https://cloudatlas.wmo.int/en/optical-thickness.html)
- [ECMWF — quantifying forecast uncertainty](https://www.ecmwf.int/en/research/modelling-and-prediction/quantifying-forecast-uncertainty)
- [Saito & Iwabuchi 2015 — twilight radiative transfer](https://doi.org/10.5194/amt-8-4295-2015)
- [彩云天气 API](https://docs.caiyunapp.com/weather-api/)
- [和风天气开发文档](https://dev.qweather.com/docs/)
- [Astronomy Engine](https://github.com/cosinekitty/astronomy)
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [NOAA Space Weather Prediction Center](https://www.swpc.noaa.gov/)
- [NOAA planetary K-index forecast](https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json)
- [International Meteor Organization](https://www.imo.net/)

以上准确性判断只描述各源的公开定位和本产品的工程取舍，不声称某一家在中国所有指标上永久排名第一。生产采购前应以目标城市、季节和预报时效做同口径实测。
