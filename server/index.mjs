import express from 'express'
import { chromium } from 'playwright'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assessPost } from '../src/relevance.js'
import { TelegramBridge, newRelevantPosts } from './telegram.mjs'

const app = express()
const port = 4318
const rootDirectory = fileURLToPath(new URL('../', import.meta.url))
const localDirectory = resolve(rootDirectory, '.local')
const profileDirectory = resolve(localDirectory, 'threads-browser')
const watchFile = resolve(localDirectory, 'watch.json')
const findingsFile = resolve(localDirectory, 'findings.json')
const telegramFile = resolve(localDirectory, 'telegram.json')
let context = null
let scanRunning = false
let scanPage = null
let scanCancelled = false
let watch = { enabled: false, projectId: '', queries: [], filters: {}, intervalMinutes: 60, nextRunAt: null, lastRunAt: null, lastError: null }
let findings = []

const telegram = new TelegramBridge({
  readState: () => readJson(telegramFile, {}),
  saveState: saveTelegramState,
  onCommand: async (command, search) => {
    if (command === '/status') return `Поиск: ${watch.enabled ? 'включён' : 'остановлен'}. ${scanRunning ? 'Сейчас идёт проверка.' : 'Сейчас ничего не проверяется.'} ${search?.queries?.length ? `Фраз: ${search.queries.length}.` : 'Фразы ещё не сохранены в приложении.'}`
    if (command === '/pause') {
      watch.enabled = false
      watch.nextRunAt = null
      await saveJson(watchFile, watch)
      await cancelScan()
      return 'Поиск остановлен. Новых проверок не будет.'
    }
    if (command === '/resume') {
      if (!search?.queries?.length) return 'Сначала нажми «Сохранить поиск для телефона» в приложении.'
      watch = { ...watch, ...search, enabled: true, nextRunAt: new Date(Date.now() + search.intervalMinutes * 60000).toISOString(), lastError: null }
      await saveJson(watchFile, watch)
      return `Регулярный поиск включён: каждые ${watch.intervalMinutes} мин. Для остановки отправь /pause.`
    }
    if (command === '/scan') {
      if (!search?.queries?.length) return 'Сначала нажми «Сохранить поиск для телефона» в приложении.'
      if (scanRunning) return 'Поиск уже идёт. Отправь /status, чтобы проверить состояние.'
      runScanAndNotify(search).then(({ notified }) => telegram.sendText(`Проверка закончена. Новых подходящих запросов: ${notified}.`).catch(() => {})).catch((error) => telegram.sendText(error.message).catch(() => {}))
      return 'Запускаю поиск. Пришлю подходящие ссылки, когда проверка завершится.'
    }
    return 'Команды: /scan — найти сейчас, /resume — включить регулярный поиск, /pause — остановить, /status — состояние.'
  },
})

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return fallback }
}

async function saveJson(path, value) {
  await mkdir(localDirectory, { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

async function saveTelegramState(value) {
  await mkdir(localDirectory, { recursive: true })
  await writeFile(telegramFile, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
  await chmod(telegramFile, 0o600)
}

app.use(express.json({ limit: '24kb' }))

function searchUrl(query) {
  const url = new URL('https://www.threads.com/search')
  url.searchParams.set('q', query)
  url.searchParams.set('serp_type', 'recent')
  return url.toString()
}

async function browserContext() {
  if (context) return context
  await mkdir(profileDirectory, { recursive: true })
  const options = {
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: 'ru-RU',
  }
  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      ...options,
      channel: 'chrome',
    })
  } catch (chromeError) {
    try {
      context = await chromium.launchPersistentContext(profileDirectory, options)
    } catch (chromiumError) {
      throw new Error(
        `Не удалось открыть Chrome или Chromium. Установи Chrome либо выполни npx playwright install chromium. ${chromiumError.message}`,
      )
    }
  }
  context.on('close', () => { context = null })
  return context
}

async function extractVisiblePosts(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/post/"]'))
    const seen = new Set()
    return links.map((link) => {
      const url = new URL(link.href, location.href)
      if (!/^\/@[^/]+\/post\/[^/]+/.test(url.pathname) || seen.has(url.pathname)) return null
      seen.add(url.pathname)

      let card = link.closest('article')
      if (!card) {
        let current = link.parentElement
        for (let depth = 0; depth < 7 && current; depth += 1) {
          const length = (current.innerText || '').trim().length
          const postLinks = current.querySelectorAll('a[href*="/post/"]').length
          if (length >= 20 && length <= 1600 && postLinks <= 3) card = current
          if (postLinks > 3 || length > 1600) break
          current = current.parentElement
        }
      }
      const rawText = (card?.innerText || link.parentElement?.innerText || '').trim()
      const text = rawText.replace(/\n{3,}/g, '\n\n').slice(0, 1800)
      const timestamp = card?.querySelector('time')?.getAttribute('datetime') || ''
      const username = url.pathname.split('/')[1]?.replace(/^@/, '') || ''
      return { url: `${url.origin}${url.pathname}`, username, text, timestamp }
    }).filter(Boolean).filter((post) => post.text.length >= 12).slice(0, 25)
      })
    } catch (error) {
      if (!/Execution context was destroyed|navigat/i.test(error.message) || attempt === 2) throw error
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(800)
    }
  }
  return []
}

async function scanQueries(queries, projectId) {
  if (scanRunning) throw new Error('Поиск уже выполняется.')
  scanRunning = true
  scanCancelled = false
  try {
    const browser = await browserContext()
    const page = browser.pages()[0] || await browser.newPage()
    scanPage = page
    const allPosts = new Map()
    const searches = []
    for (const query of queries) {
      if (scanCancelled) throw new Error('Поиск остановлен.')
      await page.goto(searchUrl(query), { waitUntil: 'domcontentloaded', timeout: 35000 })
      await page.waitForTimeout(2200)
      if (scanCancelled) throw new Error('Поиск остановлен.')
      let posts = await extractVisiblePosts(page)
      if (posts.length === 0) {
        const loginPrompt = await page.getByText(/Войдите или зарегистрируйтесь в Threads|Log in or sign up for Threads/i).count()
        if (loginPrompt) throw new Error('Threads просит войти в аккаунт. Нажми «Открыть браузер», войди в открывшемся окне и запусти поиск снова.')
      }
      if (posts.length > 0) {
        await page.mouse.wheel(0, 680)
        await page.waitForTimeout(900)
        posts = [...posts, ...await extractVisiblePosts(page)]
      }
      if (scanCancelled) throw new Error('Поиск остановлен.')
      for (const post of posts) {
        if (!allPosts.has(post.url)) allPosts.set(post.url, { ...post, query })
      }
      searches.push({ query, count: posts.length, url: searchUrl(query) })
    }
    const scannedAt = new Date().toISOString()
    const posts = [...allPosts.values()]
    let newPosts = posts
    if (projectId) {
      const existing = new Set(findings.filter((item) => item.projectId === projectId).map((item) => item.url))
      newPosts = posts.filter((item) => !existing.has(item.url))
      findings = [
        ...newPosts.map((item) => ({ ...item, projectId, foundAt: scannedAt })),
        ...findings,
      ].slice(0, 1000)
      await saveJson(findingsFile, findings)
    }
    return { posts, searches, scannedAt, newPosts }
  } catch (error) {
    if (scanCancelled) throw new Error('Поиск остановлен.')
    throw error
  } finally {
    scanRunning = false
    scanPage = null
    scanCancelled = false
  }
}

async function cancelScan() {
  if (!scanRunning) return
  scanCancelled = true
  await scanPage?.close().catch(() => {})
}

async function runScanAndNotify(search) {
  const result = await scanQueries(search.queries, search.projectId)
  const filters = { id: search.projectId, ...search.filters }
  const matches = newRelevantPosts(result.posts, new Set(telegram.state.sentUrls), filters, assessPost)
  let notified = 0
  try { notified = await telegram.notify(matches) } catch (error) { telegram.lastError = error.message }
  return { ...result, notified }
}

function validatedSearch(body) {
  const queries = Array.isArray(body?.queries)
    ? body.queries.filter((query) => typeof query === 'string').map((query) => query.trim()).filter(Boolean)
    : []
  const projectId = typeof body?.projectId === 'string' ? body.projectId.slice(0, 100) : ''
  const intervalMinutes = Number(body?.intervalMinutes || 60)
  if (!projectId || queries.length < 1 || queries.length > 8 || queries.some((query) => query.length > 120) || !Number.isInteger(intervalMinutes) || intervalMinutes < 30 || intervalMinutes > 1440) return null
  const filters = {
    topicWords: String(body?.filters?.topicWords || '').slice(0, 500),
    audienceWords: String(body?.filters?.audienceWords || '').slice(0, 500),
    maxAgeDays: [1, 7, 30].includes(Number(body?.filters?.maxAgeDays)) ? Number(body.filters.maxAgeDays) : 7,
  }
  return { projectId, queries, filters, intervalMinutes }
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, browserOpen: Boolean(context), scanRunning })
})

app.post('/api/browser/open', async (_request, response) => {
  try {
    const browser = await browserContext()
    const page = browser.pages()[0] || await browser.newPage()
    await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.bringToFront()
    response.json({ ok: true })
  } catch (error) {
    response.status(500).json({ error: error.message })
  }
})

app.post('/api/scan', async (request, response) => {
  if (scanRunning) return response.status(409).json({ error: 'Поиск уже выполняется.' })
  const search = validatedSearch(request.body)
  if (!search) return response.status(400).json({ error: 'Укажи идею и от 1 до 8 поисковых фраз.' })
  try {
    const { newPosts, ...result } = await runScanAndNotify(search)
    response.json(result)
  } catch (error) {
    response.status(500).json({ error: error.message })
  }
})

app.post('/api/scan/stop', async (_request, response) => {
  await cancelScan()
  response.json({ ok: true, scanRunning })
})

app.get('/api/findings', (request, response) => {
  const projectId = String(request.query.projectId || '')
  response.json({ posts: findings.filter((item) => item.projectId === projectId) })
})

app.get('/api/watch', (_request, response) => response.json(watch))

app.post('/api/watch', async (request, response) => {
  const enabled = request.body?.enabled === true
  const search = enabled ? validatedSearch(request.body) : null
  if (enabled && !search) {
    return response.status(400).json({ error: 'Для наблюдения нужны идея, 1–8 фраз и интервал от 30 до 1440 минут.' })
  }
  watch = {
    ...watch,
    enabled,
    ...(enabled ? search : {}),
    nextRunAt: enabled ? new Date(Date.now() + search.intervalMinutes * 60000).toISOString() : null,
    lastError: null,
  }
  await saveJson(watchFile, watch)
  if (!enabled) await cancelScan()
  response.json(watch)
})

app.get('/api/telegram', (_request, response) => response.json(telegram.status()))

app.post('/api/telegram/connect', async (request, response) => {
  try { response.json(await telegram.connect(String(request.body?.token || '').trim())) }
  catch (error) { response.status(400).json({ error: error.message }) }
})

app.post('/api/telegram/search', async (request, response) => {
  const search = validatedSearch(request.body)
  if (!search) return response.status(400).json({ error: 'Добавь от 1 до 8 активных поисковых фраз.' })
  response.json(await telegram.setSearch(search))
})

app.post('/api/telegram/test', async (_request, response) => {
  if (!telegram.state.chatId) return response.status(400).json({ error: 'Сначала подключи телефон командой /start с кодом.' })
  try {
    await telegram.sendText('Проверка связи: уведомления из Искры приходят. Ссылки на посты появятся только при новых подходящих запросах.')
    response.json({ ok: true })
  } catch (error) { response.status(502).json({ error: error.message }) }
})

app.post('/api/telegram/disconnect', async (_request, response) => {
  await telegram.disconnect()
  response.json(telegram.status())
})

async function watchTick() {
  if (!watch.enabled || scanRunning || !watch.nextRunAt || Date.now() < Date.parse(watch.nextRunAt)) return
  watch.nextRunAt = new Date(Date.now() + watch.intervalMinutes * 60000).toISOString()
  try {
    await runScanAndNotify(watch)
    watch.lastRunAt = new Date().toISOString()
    watch.lastError = null
  } catch (error) {
    if (watch.enabled) watch.lastError = error.message
  }
  await saveJson(watchFile, watch)
}

async function loadLocalState() {
  watch = { ...watch, ...await readJson(watchFile, {}) }
  findings = await readJson(findingsFile, [])
  if (!Array.isArray(findings)) findings = []
  if (watch.enabled && (!watch.nextRunAt || Date.parse(watch.nextRunAt) < Date.now())) {
    watch.nextRunAt = new Date(Date.now() + 60000).toISOString()
  }
}

await loadLocalState()
await telegram.load()
setInterval(() => { watchTick().catch((error) => console.error('Scheduled scan:', error)) }, 30000)

app.listen(port, '127.0.0.1', () => {
  console.log(`Threadslead API: http://127.0.0.1:${port}`)
})
