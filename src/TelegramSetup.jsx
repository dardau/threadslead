import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, Copy, MessageCircle, Send, ShieldCheck } from 'lucide-react'
import { ageDaysFor, audienceWordsFor, topicWordsFor } from './relevance.js'

const SERVER_UNAVAILABLE = 'Локальный сервер недоступен. Перезапусти приложение.'

async function request(path, body) {
  let response
  try { response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
  catch { throw new Error(SERVER_UNAVAILABLE) }
  let result
  try { result = await response.json() } catch { throw new Error(SERVER_UNAVAILABLE) }
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить действие')
  return result
}

export default function TelegramSetup({ project, queries, intervalMinutes }) {
  const [status, setStatus] = useState(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  useEffect(() => {
    let active = true
    const refresh = () => fetch('/api/telegram').then((response) => response.json()).then((result) => { if (active) { setStatus(result); setError((current) => current === SERVER_UNAVAILABLE ? '' : current) } }).catch(() => { if (active) setError(SERVER_UNAVAILABLE) })
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [])

  const act = async (name, work, success) => {
    setBusy(name)
    setError('')
    setNotice('')
    try {
      const result = await work()
      if (result?.connected !== undefined) setStatus(result)
      if (success) setNotice(success)
      return true
    } catch (failure) { setError(failure.message); return false }
    finally { setBusy('') }
  }

  const saveSearch = () => act('search', () => request('/api/telegram/search', {
    projectId: project.id,
    queries,
    intervalMinutes,
    filters: { topicWords: topicWordsFor(project), audienceWords: audienceWordsFor(project), maxAgeDays: ageDaysFor(project) },
  }), 'Поиск для телефона сохранён.')

  const copy = async (value) => {
    try { await navigator.clipboard.writeText(value); setNotice('Команда скопирована.') }
    catch { setError('Не удалось скопировать. Выдели команду вручную.') }
  }

  return <section className="panel telegram-panel">
    <div className="panel-header"><div><div className="section-kicker">ТЕЛЕФОН</div><h2>Ссылки в Telegram</h2><p>Получай новые запросы и открывай посты в Threads с телефона. Ответ публикуешь сам.</p></div><span className={`connection-badge ${status?.paired ? 'connected' : ''}`}><span /> {status?.paired ? 'Телефон подключён' : status?.connected ? 'Ожидает подключения' : 'Не настроено'}</span></div>
    {!status?.connected ? <div className="telegram-setup-flow">
      <p>Создай бота через <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather <ArrowUpRight size={13} /></a>, скопируй его токен и вставь сюда. Токен хранится только на этом компьютере.</p>
      <form noValidate onSubmit={(event) => { event.preventDefault(); act('connect', () => request('/api/telegram/connect', { token: token.trim() }), 'Бот подключён. Открой его на телефоне по ссылке ниже.').then((ok) => { if (ok) setToken('') }) }}>
        <label htmlFor="telegram-token">Токен Telegram-бота</label>
        <div className="telegram-token-row"><input id="telegram-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="123456789:AA..." /><button className="button button-primary" disabled={!token.trim() || Boolean(busy)} type="submit">Подключить</button></div>
      </form>
    </div> : <div className="telegram-setup-flow">
      {!status.paired ? <div className="telegram-pair"><div className="telegram-step">01</div><div><strong>Подключи свой телефон</strong><p>Открой <a href={`https://t.me/${status.botUsername}?start=${status.pairCode}`} target="_blank" rel="noreferrer">@{status.botUsername} <ArrowUpRight size={13} /></a> и нажми Start. Бот примет только человека с этим кодом.</p><div className="telegram-command"><code>/start {status.pairCode}</code><button type="button" onClick={() => copy(`/start ${status.pairCode}`)} aria-label="Скопировать команду подключения"><Copy size={15} /></button></div></div></div> : <div className="telegram-pair"><div className="telegram-step done"><Check size={16} /></div><div><strong>{status.chatName} подключён</strong><p>Бот будет присылать только новые запросы, прошедшие фильтр темы, аудитории и даты.</p></div></div>}
      <div className="telegram-pair"><div className="telegram-step">02</div><div><strong>Сохрани поиск для телефона</strong><p>Возьмём первые 8 активных фраз, текущий фильтр и интервал проверки.</p><button className="button button-secondary" disabled={!queries.length || Boolean(busy)} onClick={saveSearch}><ShieldCheck size={15} /> {status.searchReady && status.searchProjectId === project.id ? 'Обновить поиск' : 'Сохранить поиск для телефона'}</button>{status.searchReady && <small>Сохранён поиск для {status.searchProjectId === project.id ? 'этой идеи' : 'другой идеи'}.</small>}</div></div>
      {status.paired && <div className="telegram-pair"><div className="telegram-step">03</div><div><strong>Управляй с телефона</strong><p><code>/scan</code> — найти сейчас · <code>/resume</code> — регулярный поиск · <code>/pause</code> — остановить · <code>/status</code> — состояние.</p><div className="telegram-actions"><a className="button button-primary" href={`https://t.me/${status.botUsername}`} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Открыть бота</a><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => act('test', () => request('/api/telegram/test', {}), 'Пробное сообщение отправлено на телефон.')}><Send size={15} /> Проверить связь</button></div></div></div>}
      <div className="telegram-footer"><span>Поиск работает, пока включён этот компьютер и запущено приложение.</span>{confirmDisconnect ? <><button onClick={() => setConfirmDisconnect(false)}>Отмена</button><button onClick={() => act('disconnect', () => request('/api/telegram/disconnect', {}), 'Бот отключён.').then(() => setConfirmDisconnect(false))}>Да, отключить</button></> : <button onClick={() => setConfirmDisconnect(true)}>Отключить бота</button>}</div>
    </div>}
    {error && <div className="error-box" role="alert">{error}</div>}
    {status?.lastError && <div className="warning-note">Связь с Telegram: {status.lastError}</div>}
    {notice && <div className="telegram-notice" role="status">{notice}</div>}
  </section>
}
