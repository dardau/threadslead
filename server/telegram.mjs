import { randomBytes } from 'node:crypto'

const API_ROOT = 'https://api.telegram.org/bot'
const MAX_SENT_URLS = 2000

export function formatFindings(posts) {
  return posts.map((post, index) => {
    const excerpt = post.text.replace(/\s+/g, ' ').trim().slice(0, 230)
    return `${index + 1}. @${post.username || 'автор'}\n${excerpt}\n${post.url}`
  }).join('\n\n')
}

export function newRelevantPosts(posts, existingUrls, filters, assessPost) {
  return posts.filter((post) => !existingUrls.has(post.url) && assessPost(post, filters).category === 'Запрос')
}

export class TelegramBridge {
  constructor({ readState, saveState, onCommand }) {
    this.readState = readState
    this.saveState = saveState
    this.onCommand = onCommand
    this.state = { token: '', botUsername: '', pairCode: '', chatId: null, chatName: '', updateOffset: 0, sentUrls: [], search: null }
    this.polling = false
    this.lastError = ''
  }

  async load() {
    const stored = await this.readState()
    this.state = { ...this.state, ...stored }
    if (!Array.isArray(this.state.sentUrls)) this.state.sentUrls = []
    if (this.state.token) this.startPolling()
  }

  async api(method, body = {}, token = this.state.token, timeoutMs = 35000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${API_ROOT}${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.description || 'Telegram не ответил')
      return result.result
    } finally { clearTimeout(timer) }
  }

  async connect(token) {
    if (!/^\d{6,15}:[A-Za-z0-9_-]{25,}$/.test(token)) throw new Error('Проверь токен бота из BotFather.')
    const identity = await this.api('getMe', {}, token, 10000)
    this.state = {
      ...this.state,
      token,
      botUsername: identity.username,
      pairCode: randomBytes(12).toString('base64url'),
      chatId: null,
      chatName: '',
      updateOffset: 0,
      sentUrls: [],
    }
    this.lastError = ''
    await this.saveState(this.state)
    try {
      await this.api('setMyCommands', { commands: [
        { command: 'scan', description: 'Найти подходящие посты сейчас' },
        { command: 'resume', description: 'Включить регулярный поиск' },
        { command: 'pause', description: 'Остановить поиск' },
        { command: 'status', description: 'Проверить состояние' },
      ] }, token, 10000)
    } catch { /* Commands still work when Telegram cannot update the menu. */ }
    this.startPolling()
    return this.status()
  }

  async disconnect() {
    this.state = { ...this.state, token: '', botUsername: '', pairCode: '', chatId: null, chatName: '', updateOffset: 0, sentUrls: [] }
    this.lastError = ''
    await this.saveState(this.state)
  }

  async setSearch(search) {
    this.state.search = search
    await this.saveState(this.state)
    return this.status()
  }

  status() {
    return {
      connected: Boolean(this.state.token),
      botUsername: this.state.botUsername,
      paired: Boolean(this.state.chatId),
      chatName: this.state.chatName,
      pairCode: this.state.chatId ? null : this.state.pairCode,
      searchReady: Boolean(this.state.search?.queries?.length),
      searchProjectId: this.state.search?.projectId || '',
      lastError: this.lastError,
    }
  }

  async sendText(text) {
    if (!this.state.chatId) return false
    await this.sendTo(this.state.chatId, text)
    return true
  }

  async sendTo(chatId, text) {
    await this.api('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } }, this.state.token, 10000)
  }

  async notify(posts) {
    if (!this.state.chatId || posts.length === 0) return 0
    const sent = new Set(this.state.sentUrls)
    const unsent = posts.filter((post) => !sent.has(post.url))
    let count = 0
    for (let offset = 0; offset < unsent.length; offset += 8) {
      const batch = unsent.slice(offset, offset + 8)
      await this.sendText(`Новые запросы в Threads (${batch.length})\n\n${formatFindings(batch)}\n\nОткрой ссылку на телефоне и ответь в Threads после проверки поста.`)
      this.state.sentUrls = [...this.state.sentUrls, ...batch.map((post) => post.url)].slice(-MAX_SENT_URLS)
      await this.saveState(this.state)
      count += batch.length
    }
    return count
  }

  startPolling() {
    if (this.polling) return
    this.polling = true
    this.pollLoop().finally(() => { this.polling = false; if (this.state.token) setTimeout(() => this.startPolling(), 5000) })
  }

  async pollLoop() {
    while (this.state.token) {
      const token = this.state.token
      try {
        const updates = await this.api('getUpdates', { offset: this.state.updateOffset, timeout: 20, allowed_updates: ['message'] }, token, 26000)
        if (this.state.token !== token) continue
        for (const update of updates) {
          this.state.updateOffset = Math.max(this.state.updateOffset, update.update_id + 1)
          await this.handleMessage(update.message)
        }
        if (updates.length) await this.saveState(this.state)
        this.lastError = ''
      } catch (error) {
        this.lastError = error.name === 'AbortError' ? 'Telegram не ответил вовремя' : error.message
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
    }
  }

  async handleMessage(message) {
    if (!message?.chat?.id || typeof message.text !== 'string') return
    const chatId = message.chat.id
    const [commandRaw, argument] = message.text.trim().split(/\s+/, 2)
    const command = commandRaw.toLowerCase().replace(/@.+$/, '')
    if (!this.state.chatId) {
      if (message.chat.type !== 'private') return
      if (command !== '/start' || argument !== this.state.pairCode) {
        if (command === '/start') await this.sendTo(chatId, 'Для подключения нужен код из приложения «Искра». Открой ссылку на бота в разделе «Ссылки в Telegram» или отправь /start и код через пробел.')
        return
      }
      this.state.chatId = chatId
      this.state.chatName = message.from?.first_name || message.from?.username || 'Телефон'
      this.state.pairCode = ''
      await this.saveState(this.state)
      await this.sendText('Телефон подключён. Команды: /scan — найти сейчас, /resume — включить регулярный поиск, /pause — остановить, /status — состояние. Сначала сохрани поисковые фразы в приложении.')
      return
    }
    if (chatId !== this.state.chatId) return
    let reply
    try { reply = await this.onCommand(command, this.state.search) }
    catch (error) { reply = `Не удалось выполнить команду: ${error.message}` }
    if (reply) await this.sendText(reply)
  }
}
