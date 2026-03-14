# PulseScope 舆情分析平台

当前项目包含：

- 本地 `Node.js` 后端服务
- 总览、监测、详情、提醒四个页面
- 自动翻译能力
- 个性化偏好推荐
- 智能推送提示
- 打包桌面版 `EXE` 的脚本

## 启动方式

在项目目录执行：

```bash
npm start
```

启动后访问：

```text
http://localhost:4173
```

## 打包桌面版 EXE

在项目目录执行：

```bash
npm run build:exe
```

执行完成后，会在桌面生成：

```text
GovInsightConsole.exe
```

## 当前接口

- `/api/health`
- `/api/dashboard`
- `/api/dashboard?interest=brand,product`
- `/api/monitor?filter=all`
- `/api/monitor?filter=brand`
- `/api/monitor?filter=product`
- `/api/monitor?filter=campaign`
- `/api/monitor?filter=community`
- `/api/events`
- `/api/events?id=事件ID`
- `/api/events/:id`
- `/api/warnings`

说明：

- `dashboard`、`monitor`、`warnings` 接口都支持 `interest` 参数，用来按用户偏好返回推荐内容
- 所有接口都支持追加 `refresh` 查询参数，例如 `/api/dashboard?refresh=1`
- 带 `refresh` 参数时，后端会清空聚合缓存并重新拉取数据

## 数据说明

- 公开资讯：`HN Algolia`
- 自动翻译：`MyMemory`
- 本地后端负责聚合、缓存、翻译、推荐和衍生指标计算
- 前端负责展示、交互和推送提示

## 页面说明

- `index.html`：实时舆情总览，展示情绪脉冲、主题热度、趋势、推荐和热点清单
- `monitor.html`：实时监测，展示监测流、标签聚合、偏好命中和即时推荐
- `detail.html`：事件详情，展示摘要、时间线、情绪结构、建议动作和关联内容
- `warning.html`：提醒中心，展示分级提醒、触发规则、响应队列和提醒事件清单
