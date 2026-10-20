import express from 'express'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const app = express()
const port = 4318
const profileDirectory = resolve('.local/threads-browser')
const watchFile = resolve('.local/watch.json')
const findingsFile = resolve('.local/findings.json')
let context = null
let scanRunning = false
let watch = { enabled: false, projectId: '', queries: [], intervalMinutes: 60, nextRunAt: null, lastRunAt: null, lastError: null }
let findings = []

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return fallback }
}

async function saveJson(path, value) {
  await mkdir(resolve('.local'), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
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
  try {
    const browser = await browserContext()
    const page = browser.pages()[0] || await browser.newPage()
    const allPosts = new Map()
    const searches = []
    for (const query of queries) {
      await page.goto(searchUrl(query), { waitUntil: 'domcontentloaded', timeout: 35000 })
      await page.waitForTimeout(2200)
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
      for (const post of posts) {
        if (!allPosts.has(post.url)) allPosts.set(post.url, { ...post, query })
      }
      searches.push({ query, count: posts.length, url: searchUrl(query) })
    }
    const scannedAt = new Date().toISOString()
    const posts = [...allPosts.values()]
    if (projectId) {
      const existing = new Set(findings.filter((item) => item.projectId === projectId).map((item) => item.url))
      findings = [
        ...posts.filter((item) => !existing.has(item.url)).map((item) => ({ ...item, projectId, foundAt: scannedAt })),
        ...findings,
      ].slice(0, 1000)
      await saveJson(findingsFile, findings)
    }
    return { posts, searches, scannedAt }
  } finally {
    scanRunning = false
  }
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
  const queries = Array.isArray(request.body?.queries)
    ? request.body.queries.filter((query) => typeof query === 'string').map((query) => query.trim()).filter(Boolean)
    : []
  if (queries.length === 0 || queries.length > 8 || queries.some((query) => query.length > 120)) {
    return response.status(400).json({ error: 'Передай от 1 до 8 запросов длиной до 120 символов.' })
  }
  try {
    response.json(await scanQueries(queries, typeof request.body?.projectId === 'string' ? request.body.projectId : ''))
  } catch (error) {
    response.status(500).json({ error: error.message })
  }
})

app.get('/api/findings', (request, response) => {
  const projectId = String(request.query.projectId || '')
  response.json({ posts: findings.filter((item) => item.projectId === projectId) })
})

app.get('/api/watch', (_request, response) => response.json(watch))

app.post('/api/watch', async (request, response) => {
  const enabled = request.body?.enabled === true
  const queries = Array.isArray(request.body?.queries)
    ? request.body.queries.filter((query) => typeof query === 'string').map((query) => query.trim()).filter(Boolean)
    : []
  const intervalMinutes = Number(request.body?.intervalMinutes || 60)
  const projectId = String(request.body?.projectId || '')
  if (enabled && (!projectId || queries.length < 1 || queries.length > 8 || queries.some((query) => query.length > 120) || !Number.isInteger(intervalMinutes) || intervalMinutes < 30 || intervalMinutes > 1440)) {
    return response.status(400).json({ error: 'Для наблюдения нужны идея, 1–8 фраз и интервал от 30 до 1440 минут.' })
  }
  watch = {
    ...watch,
    enabled,
    projectId: enabled ? projectId : watch.projectId,
    queries: enabled ? queries : watch.queries,
    intervalMinutes: enabled ? intervalMinutes : watch.intervalMinutes,
    nextRunAt: enabled ? new Date(Date.now() + intervalMinutes * 60000).toISOString() : null,
    lastError: null,
  }
  await saveJson(watchFile, watch)
  response.json(watch)
})

async function watchTick() {
  if (!watch.enabled || scanRunning || !watch.nextRunAt || Date.now() < Date.parse(watch.nextRunAt)) return
  watch.nextRunAt = new Date(Date.now() + watch.intervalMinutes * 60000).toISOString()
  try {
    await scanQueries(watch.queries, watch.projectId)
    watch.lastRunAt = new Date().toISOString()
    watch.lastError = null
  } catch (error) {
    watch.lastError = error.message
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
setInterval(() => { watchTick().catch((error) => console.error('Scheduled scan:', error)) }, 30000)

app.listen(port, '127.0.0.1', () => {
  console.log(`Threadslead API: http://127.0.0.1:${port}`)
})
