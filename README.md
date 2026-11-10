# dsh-peak-strip · 峰谷提示条

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 **DSH Go** 手机原生界面加一行峰谷提示：当前是高峰还是空闲、距离切换还有多久。

- 输入框上方一行：`峰 ×2 · 距空闲 2:58:31`，谷时变成 `谷 5折 · 距高峰 1天 23:00`，高峰橙、谷时绿
- 点这一行弹出小面板：当前时段与倍率、切换倒计时、下次切换的具体时间、**今天花费（高峰 / 谷时 / 合计）**、时段规则，不跳转页面
- 每秒刷新一次。**不联网、不上报**；花费按每条模型响应自带的 `usage` 在本地估算，账目存在 `~/.dsh/peak-strip/state.json`（重启不丢、跨天自动清零）

## 规则

按 DeepSeek 现行峰谷定价：

| 时段 | 北京时间 | 价格 |
| --- | --- | --- |
| 高峰 | 工作日 09:00–12:00、14:00–18:00 | ×2 |
| 空闲 | 其余时间，周末全天 | 高峰的一半 |

时段写在 `lib/index.js` 的 `PEAK_WINDOWS` 里，官方调整后改这一处即可。

花费按 `lib/index.js` 的 `PEAK_PRICES` 估算，**从插件加载后开始累计**（之前的历史看不到），且只是估算，实际以 DeepSeek 账单为准。

## 安装

```sh
dsh plugin --profile web add dsh-peak-strip
```

装到跑 DSH Go 本机引擎的 profile 上。装完在 App 的「引擎」页重启一次引擎，输入框上方就会出现这一行。

卸载：

```sh
dsh plugin --profile web remove dsh-peak-strip
```

## 兼容

- DSH `>=0.2.1-rc.2 <0.3.0-0`
- 只在带 dsh-go 桥接的主机上有原生界面（手机本机引擎）；其他主机上不显示
- 视图使用 v1 组件，旧版 App 也能画

## 开发

```sh
node ~/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load
```

---

# dsh-peak-strip · Peak hours strip

A native **DSH Go** status strip that shows whether you are in DeepSeek's peak pricing window, plus a live countdown to the next switch. Tap it for a small panel; nothing leaves the device.

- Peak: weekdays 09:00–12:00 and 14:00–18:00 Beijing time (×2 price)
- Off-peak: everything else, including weekends (half price)

```sh
dsh plugin --profile web add dsh-peak-strip
```

MIT License.
