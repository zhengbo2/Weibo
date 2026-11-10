// 峰谷提示：DeepSeek 工作日高峰（北京时间 09:00–12:00、14:00–18:00）之外为空闲，
// 空闲价是高峰的一半。状态条显示时段与倒计时，面板显示今日花费和 24 小时时段图。
export const name = 'local-peak-hours'

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const OFFSET = 8 * 3600e3
const MINUTE = 60e3
const DAY = 24 * 3600e3

// 高峰区间（北京时间，分钟数），只在周一至周五生效。
const PEAK_WINDOWS = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
]

// 高峰单价（元 / 百万 token）；空闲按一半算。
const PEAK_PRICES = { cacheRead: 0.2, input: 2, output: 3 }

const zeroBuckets = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

function beijing(ts) {
  return new Date(ts + OFFSET)
}

function isPeak(ts) {
  const d = beijing(ts)
  const weekday = d.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  return PEAK_WINDOWS.some(([from, to]) => minutes >= from && minutes < to)
}

// 下一个状态切换点：按分钟向后找，最多找 8 天。
function nextChange(ts) {
  const current = isPeak(ts)
  let probe = Math.floor(ts / MINUTE) * MINUTE
  for (let i = 0; i < 8 * 24 * 60; i++) {
    probe += MINUTE
    if (isPeak(probe) !== current) return probe
  }
  return undefined
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function fmtCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}天 ${hours}:${pad(minutes)}`
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}

function fmtWhen(ts, now) {
  const d = beijing(ts)
  const today = beijing(now)
  const dayDiff = Math.round(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
      - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / DAY,
  )
  const clock = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  if (dayDiff === 0) return `今天 ${clock}`
  if (dayDiff === 1) return `明天 ${clock}`
  return `周${'日一二三四五六'[d.getUTCDay()]} ${clock}`
}

function dayKey(ts) {
  const d = beijing(ts)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function addBuckets(a, b) {
  return {
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  }
}

function costOf(b, peak) {
  const factor = peak ? 1 : 0.5
  return (
    (b.uncachedInputTokens ?? 0) * PEAK_PRICES.input
    + (b.cacheReadTokens ?? 0) * PEAK_PRICES.cacheRead
    + ((b.outputTokens ?? 0) + (b.cacheWriteTokens ?? 0)) * PEAK_PRICES.output
  ) * factor / 1e6
}

function fmtCost(c) {
  if (!(c > 0)) return '¥0'
  if (c >= 1) return `¥${c.toFixed(2)}`
  if (c >= 0.01) return `¥${c.toFixed(2)}`
  return `¥${c.toFixed(3)}`
}

const STATE_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'peak-strip', 'state.json')

export function apply(ctx) {
  const today = { date: dayKey(Date.now()), peak: zeroBuckets(), off: zeroBuckets() }

  try {
    if (existsSync(STATE_FILE)) {
      const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
      if (saved && saved.date === today.date) {
        today.peak = { ...zeroBuckets(), ...(saved.peak ?? {}) }
        today.off = { ...zeroBuckets(), ...(saved.off ?? {}) }
      }
    }
  } catch {}

  let saving
  const save = () => {
    clearTimeout(saving)
    saving = setTimeout(() => {
      try {
        mkdirSync(dirname(STATE_FILE), { recursive: true })
        writeFileSync(STATE_FILE, JSON.stringify({ date: today.date, peak: today.peak, off: today.off }))
      } catch {}
    }, 500)
    saving.unref?.()
  }

  const rollDay = (ts) => {
    const key = dayKey(ts)
    if (key !== today.date) {
      today.date = key
      today.peak = zeroBuckets()
      today.off = zeroBuckets()
      save()
    }
  }

  // 每步 assistant 响应带一条真实 usage，按发生时刻记到高峰或谷时。
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'assistant/message') return
    const usage = event.data?.usage
    if (!usage || typeof usage !== 'object') return
    const now = Date.now()
    rollDay(now)
    const used = {
      uncachedInputTokens: Number(usage.inputTokens) || 0,
      cacheReadTokens: Number(usage.cacheReadTokens) || 0,
      cacheWriteTokens: Number(usage.cacheWriteTokens) || 0,
      outputTokens: Number(usage.outputTokens) || 0,
    }
    if (isPeak(now)) today.peak = addBuckets(today.peak, used)
    else today.off = addBuckets(today.off, used)
    save()
  })

  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.strip('peak-strip', (scope, emit, caps) => {
      const en = String(caps?.locale ?? '').startsWith('en')
      const tick = () => {
        const now = Date.now()
        const peak = isPeak(now)
        const target = nextChange(now)
        const label = peak ? (en ? 'Peak' : '峰') : (en ? 'Off' : '谷')
        const rate = peak ? '×2' : (en ? 'half' : '5折')
        const ahead = peak ? (en ? 'to off ' : '距空闲 ') : (en ? 'to peak ' : '距高峰 ')
        emit({ text: `${label} ${rate} · ${ahead}${target === undefined ? '—' : fmtCountdown(target - now)}`, icon: 'clock', tone: peak ? 'warn' : 'good' })
      }
      tick()
      const timer = setInterval(tick, 1000)
      return () => clearInterval(timer)
    })

    ctx.dshGo.panel('peak', {
      view: () => {
        return {
          type: 'stack',
          title: '峰谷',
          children: [
            { type: 'metric', label: '当前', value: { $: 'data.state' }, caption: { $: 'data.rate' } },
            { type: 'metric', label: '距离切换', value: { $: 'data.countdown' }, caption: { $: 'data.when' } },
            { type: 'table', columns: ['今天', '估算'], rows: { $: 'data.rows' } },
            { type: 'keyValue', items: [['高峰时段', '工作日 09:00–12:00、14:00–18:00'], ['空闲时段', '其余时间，周末全天']] },
            { type: 'text', text: '花费按 DeepSeek 公开价估算，空闲按半价；从插件加载后开始累计，实际以账单为准。', tone: 'muted' },
          ],
        }
      },
      data: (scope, emit, caps) => {
        const en = String(caps?.locale ?? '').startsWith('en')
        const push = () => {
          const now = Date.now()
          rollDay(now)
          const peak = isPeak(now)
          const target = nextChange(now)
          const peakCost = costOf(today.peak, true)
          const offCost = costOf(today.off, false)
          emit({
            state: peak ? (en ? 'Peak' : '高峰') : (en ? 'Off-peak' : '空闲'),
            rate: peak ? (en ? 'double price' : '×2 价格') : (en ? 'half price' : '价格为一半'),
            countdown: target === undefined ? '—' : fmtCountdown(target - now),
            when: target === undefined ? '—' : `${fmtWhen(target, now)} ${peak ? (en ? 'off-peak' : '进入空闲') : (en ? 'peak' : '进入高峰')}`,
            rows: [
              [en ? 'Peak spend' : '高峰花费', fmtCost(peakCost)],
              [en ? 'Off-peak spend' : '谷时花费', fmtCost(offCost)],
              [en ? 'Total' : '合计', fmtCost(peakCost + offCost)],
            ],
          })
        }
        push()
        const timer = setInterval(push, 1000)
        return () => clearInterval(timer)
      },
    })
  })
}
