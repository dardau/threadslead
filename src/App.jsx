import { useEffect, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck,
  ChevronDown, CircleHelp, Clock3, Copy, Download, ExternalLink, FileText,
  Filter, Inbox, Lightbulb, Link2, LoaderCircle, MapPin, Menu, MoreHorizontal,
  Plus, Radar, Search, Settings2, ShieldCheck, Sparkles, Trash2, X,
} from 'lucide-react'
import ContentStudio from './ContentStudio.jsx'
import { ageDaysFor, assessPost, audienceWordsFor, isRecentPost, topicWordsFor } from './relevance.js'

const STORAGE_KEY = 'threadslead:workspace:v1'
const STATUS_LABELS = { new: 'Новый', contacted: 'Написал', replied: 'Ответил', closed: 'Закрыт' }
const INITIAL = {
  projects: [{
    id: 'demo-school',
    name: 'Школа программирования',
    idea: 'Онлайн-занятия по веб-разработке для детей и подростков',
    audience: 'Родители детей 10–16 лет',
    region: 'Алматы',
    phrases: [
      { id: 'q1', text: 'ищу курсы программирования для ребенка', enabled: true },
      { id: 'q2', text: 'посоветуйте кружок программирования для детей', enabled: true },
      { id: 'q3', text: 'хочу научить ребенка веб разработке', enabled: true },
      { id: 'q4', text: 'где учить подростка программировать', enabled: true },
    ],
  }],
  activeProjectId: 'demo-school',
  evidence: [],
  leads: [],
  drafts: [],
}

const uid = () => crypto.randomUUID()
const dateText = (value) => value ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(value)) : '—'
const dateTimeText = (value) => value ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
const searchUrl = (query) => `https://www.threads.com/search?q=${encodeURIComponent(query)}&serp_type=recent`
const isThreadsPost = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ['threads.com', 'www.threads.com'].includes(url.hostname) && /\/@[^/]+\/post\/[^/]+/.test(url.pathname)
  } catch { return false }
}
const categoryFor = (text) => /(ищу|ищем|посоветуйте|нужен|нужна|нужно|подскажите|порекомендуйте|где найти|хочу найти|хотим найти)/i.test(text) ? 'Запрос' : 'Обсуждение'

function readInitial() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (saved && Array.isArray(saved.projects) && saved.projects.length) return saved
  } catch { /* Fall back to the example workspace. */ }
  return INITIAL
}

function IconButton({ icon: Icon, label, onClick, className = '', disabled = false }) {
  return <button type="button" className={`icon-button ${className}`} onClick={onClick} aria-label={label} title={label} disabled={disabled}><Icon size={17} strokeWidth={1.8} /></button>
}

function Modal({ title, subtitle, children, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon={X} label="Закрыть" onClick={onClose} /></div>
      {children}
    </section>
  </div>
}

function App() {
  const [data, setData] = useState(readInitial)
  const [view, setView] = useState('overview')
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [browserOpen, setBrowserOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState([])
  const [scanInfo, setScanInfo] = useState(null)
  const [apiError, setApiError] = useState('')
  const [watch, setWatch] = useState(null)
  const [watchInterval, setWatchInterval] = useState(60)
  const [leadFilter, setLeadFilter] = useState('all')
  const project = data.projects.find((item) => item.id === data.activeProjectId) || data.projects[0]
  const evidence = data.evidence.filter((item) => item.projectId === project.id)
  const leads = data.leads.filter((item) => item.projectId === project.id)
  const drafts = data.drafts.filter((item) => item.projectId === project.id)
  const activePhrases = project.phrases.filter((item) => item.enabled && item.text.trim())
  const searchQueries = activePhrases.slice(0, 8).map((item) => project.includeRegion && project.region ? `${item.text.trim()} ${project.region.trim()}` : item.text.trim())
  const directSignals = evidence.filter((item) => item.category === 'Запрос').length
  const queryProgress = directSignals === 0 ? 0 : Math.min(100, (directSignals / 5) * 100)

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) }, [data])
  useEffect(() => {
    fetch('/api/health').then((response) => response.json()).then((result) => setBrowserOpen(result.browserOpen)).catch(() => {})
  }, [])
  useEffect(() => {
    fetch(`/api/findings?projectId=${encodeURIComponent(project.id)}`).then((response) => response.json()).then((result) => setScanResults(result.posts || [])).catch(() => {})
    fetch('/api/watch').then((response) => response.json()).then((result) => { setWatch(result); setWatchInterval(result.intervalMinutes || 60) }).catch(() => {})
  }, [project.id])
  useEffect(() => {
    if (view !== 'demand') return undefined
    const refresh = () => {
      fetch(`/api/findings?projectId=${encodeURIComponent(project.id)}`).then((response) => response.json()).then((result) => setScanResults(result.posts || [])).catch(() => {})
      fetch('/api/watch').then((response) => response.json()).then(setWatch).catch(() => {})
    }
    const timer = setInterval(refresh, 30000)
    return () => clearInterval(timer)
  }, [view, project.id])
  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 3600)
    return () => clearTimeout(timer)
  }, [toast])

  const patchProject = (patch) => setData((current) => ({
    ...current,
    projects: current.projects.map((item) => item.id === project.id ? { ...item, ...patch } : item),
  }))
  const addEvidence = (entry) => {
    const url = entry.url.trim().replace(/\/$/, '')
    if (!isThreadsPost(url)) return setToast('Нужна ссылка на отдельный пост Threads')
    if (data.evidence.some((item) => item.projectId === project.id && item.url === url)) return setToast('Этот пост уже сохранён')
    setData((current) => ({ ...current, evidence: [{ id: uid(), projectId: project.id, url, text: entry.text.trim(), username: entry.username || '', query: entry.query || '', category: entry.category || categoryFor(entry.text), createdAt: new Date().toISOString() }, ...current.evidence] }))
    setToast('Пост добавлен в доказательства спроса')
    return true
  }
  const promoteLead = (item) => {
    if (data.leads.some((lead) => lead.evidenceId === item.id)) return setToast('Этот пост уже в лидах')
    setData((current) => ({ ...current, leads: [{ id: uid(), projectId: project.id, evidenceId: item.id, url: item.url, username: item.username, text: item.text, status: 'new', note: '', createdAt: new Date().toISOString() }, ...current.leads] }))
    setToast('Лид добавлен')
  }
  const createProject = (form) => {
    const name = form.name.trim()
    if (!name) return false
    const id = uid()
    setData((current) => ({ ...current, activeProjectId: id, projects: [...current.projects, { id, name, idea: form.idea.trim(), audience: form.audience.trim(), region: form.region.trim(), phrases: [] }] }))
    setScanResults([])
    setView('overview')
    setToast('Новая идея создана')
    return true
  }
  const openBrowser = async () => {
    setApiError('')
    try {
      const response = await fetch('/api/browser/open', { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Не удалось открыть браузер')
      setBrowserOpen(true)
      setToast('Окно Threads открыто. Войди в аккаунт, если нужно.')
    } catch (error) { setApiError(error.message) }
  }
  const runScan = async () => {
    if (!activePhrases.length) return setToast('Добавь хотя бы одну активную фразу')
    setScanning(true)
    setApiError('')
    try {
      const response = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, queries: searchQueries }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Поиск не завершился')
      setBrowserOpen(true)
      const stored = await fetch(`/api/findings?projectId=${encodeURIComponent(project.id)}`).then((item) => item.json())
      setScanResults(stored.posts || result.posts)
      setScanInfo(result)
      setToast(`Поиск завершён: ${result.posts.filter((post) => isRecentPost(post, project)).length} публикаций за выбранный период`)
    } catch (error) {
      setApiError(error.message)
      fetch('/api/health').then((response) => response.json()).then((result) => setBrowserOpen(result.browserOpen)).catch(() => {})
    }
    finally { setScanning(false) }
  }
  const toggleWatch = async () => {
    setApiError('')
    try {
      const enabled = !(watch?.enabled && watch.projectId === project.id)
      const response = await fetch('/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, projectId: project.id, queries: searchQueries, intervalMinutes: Number(watchInterval) }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Не удалось изменить наблюдение')
      setWatch(result)
      setToast(enabled ? 'Периодический поиск включён' : 'Периодический поиск остановлен')
    } catch (error) { setApiError(error.message) }
  }
  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = `iskra-data-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }
  const generateDraft = (type) => {
    const text = type === 'post'
      ? `Как понять, подходит ли вам ${project.name.toLowerCase()}?\n\nМы работаем с ${project.audience || 'людьми, которым интересна эта тема'} и часто слышим один вопрос: с чего начать?\n\n${project.idea || 'Расскажите здесь о своём подходе и результате для клиента.'}\n\nА что для вас сейчас самое сложное в этой теме?`
      : `Привет! Увидел ваш вопрос. ${project.idea || `Мы занимаемся направлением «${project.name}».`} Если актуально, могу коротко рассказать, как это устроено и кому подходит. Что для вас важнее всего при выборе?`
    setData((current) => ({ ...current, drafts: [{ id: uid(), projectId: project.id, type, title: type === 'post' ? 'Пост о проблеме клиента' : 'Ответ на запрос', text, createdAt: new Date().toISOString() }, ...current.drafts] }))
    setToast('Черновик создан — отредактируй перед публикацией')
  }
  const addDrafts = (items) => setData((current) => ({ ...current, drafts: [
    ...items.map((item) => ({ ...item, id: uid(), projectId: project.id, createdAt: new Date().toISOString() })),
    ...current.drafts,
  ] }))

  const nav = [
    { id: 'overview', label: 'Обзор', icon: Activity },
    { id: 'demand', label: 'Проверка спроса', icon: Radar },
    { id: 'leads', label: 'Лиды', icon: Inbox, count: leads.length },
    { id: 'content', label: 'Контент', icon: FileText },
    { id: 'settings', label: 'Настройки', icon: Settings2, mobileOnly: true },
  ]
  const currentTitle = { overview: 'Обзор идеи', demand: 'Проверка спроса', leads: 'Лиды', content: 'Контент', settings: 'Настройки' }[view]

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={19} fill="currentColor" strokeWidth={1.8} /></div><div><strong>искра<span>.</span></strong><small>Идеи в действие</small></div></div>
      <div className="sidebar-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <button className="project-switcher" onClick={() => setModal('project-switch')}><span className="project-avatar">{project.name.charAt(0).toUpperCase()}</span><span className="project-switcher-text"><b>{project.name}</b><small>{project.region || 'Без региона'}</small></span><ChevronDown size={16} /></button>
      <div className="sidebar-label nav-label">НАВИГАЦИЯ</div>
      <nav className="main-nav" aria-label="Разделы">
        {nav.map(({ id, label, icon: Icon, count, mobileOnly }) => <button key={id} className={`nav-item ${mobileOnly ? 'mobile-only' : ''} ${view === id ? 'active' : ''}`} onClick={() => setView(id)}><Icon size={19} strokeWidth={1.8} /><span>{label}</span>{Boolean(count) && <span className="nav-count">{count}</span>}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><div className="note-icon"><ShieldCheck size={17} /></div><strong>Всё под твоим контролем</strong><p>Данные хранятся в этом браузере. Ничего не публикуется автоматически.</p></div>
        <button className={`nav-item settings-link ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><Settings2 size={19} /><span>Настройки</span></button>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Мои идеи</span><span className="slash">/</span><strong>{currentTitle}</strong></div><div className="topbar-right"><span className="local-indicator"><span /> Локальная версия</span><button className="help-button" onClick={() => setModal('help')} aria-label="Как это работает"><CircleHelp size={19} /></button></div></header>
      <div className="page-content">
        {view === 'overview' && <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> РАБОЧАЯ ИДЕЯ</div><h1>От идеи до первого клиента<span className="heading-dot">.</span></h1><p>Проверь спрос в реальных разговорах, сохрани заинтересованных людей и подготовь ответ.</p></div><button className="button button-secondary" onClick={() => setModal('edit-project')}><Settings2 size={16} /> Настроить идею</button></div>
          <div className="idea-banner"><div className="idea-banner-icon"><Lightbulb size={25} /></div><div className="idea-banner-copy"><div className="banner-kicker">СЕЙЧАС ИССЛЕДУЕМ</div><h2>{project.name}</h2><p>{project.idea || 'Добавь описание: что ты предлагаешь и кому это полезно.'}</p><div className="idea-meta"><span><MapPin size={14} /> {project.region || 'Любой регион'}</span><span><BookOpen size={14} /> {project.audience || 'Аудитория не указана'}</span></div></div><div className="banner-decoration">✳</div></div>
          <div className="metrics-grid"><Metric icon={Search} label="Поисковые фразы" value={activePhrases.length} detail="активных запросов" tone="blue" /><Metric icon={Radar} label="Сигналы спроса" value={directSignals} detail="явных запросов людей" tone="orange" /><Metric icon={Inbox} label="Потенциальные лиды" value={leads.length} detail="в рабочем списке" tone="green" /></div>
          <div className="section-heading"><div><h2>Твой маршрут</h2><p>Три шага, которые превращают гипотезу в разговор с клиентом.</p></div></div>
          <div className="workflow-grid">
            <WorkflowCard number="01" icon={Search} title="Найди разговоры" text="Добавь фразы и запусти поиск по свежим публикациям Threads." action="Проверить спрос" onClick={() => setView('demand')} active />
            <WorkflowCard number="02" icon={Inbox} title="Собери лидов" text="Отметь людей, которые сами описали потребность или задали вопрос." action="Открыть лиды" onClick={() => setView('leads')} />
            <WorkflowCard number="03" icon={FileText} title="Подготовь ответ" text="Создай черновик поста или ответа и отредактируй своим голосом." action="К контенту" onClick={() => setView('content')} />
          </div>
          <div className="two-column overview-bottom"><div className="panel insight-panel"><div className="panel-top"><div className="panel-icon purple"><Activity size={18} /></div><span className="eyebrow-muted">ПРОВЕРКА ГИПОТЕЗЫ</span></div><h3>{directSignals === 0 ? 'Пока рано делать вывод' : directSignals < 5 ? 'Первые сигналы уже есть' : 'Спрос стоит изучить глубже'}</h3><p>{directSignals === 0 ? 'Найди и сохрани несколько конкретных запросов от разных людей. Это поможет понять, какой вопрос повторяется.' : `Сохранено ${directSignals} явных запросов. Посмотри, повторяется ли одна и та же проблема и подходят ли эти люди твоей аудитории.`}</p><div className="progress-track"><span style={{ width: `${queryProgress}%` }} /></div><small>{directSignals} / 5 запросов для первого качественного обзора</small></div><div className="panel quiet-panel"><div className="quiet-art"><span>✦</span><span>✳</span><span>✦</span></div><h3>Хороший поиск начинается с формулировок</h3><p>Ищи не название своей услуги, а слова, которыми человек описывает задачу: «ищу», «посоветуйте», «где найти».</p><button className="text-link" onClick={() => setView('demand')}>Настроить фразы <ArrowRight size={15} /></button></div></div>
        </>}

        {view === 'demand' && <DemandView project={project} patchProject={patchProject} evidence={evidence} addEvidence={addEvidence} promoteLead={promoteLead} leads={leads} scanResults={scanResults} scanInfo={scanInfo} apiError={apiError} browserOpen={browserOpen} scanning={scanning} openBrowser={openBrowser} runScan={runScan} watch={watch} watchInterval={watchInterval} setWatchInterval={setWatchInterval} toggleWatch={toggleWatch} setModal={setModal} setToast={setToast} />}
        {view === 'leads' && <LeadsView leads={leads} filter={leadFilter} setFilter={setLeadFilter} updateLead={(id, patch) => setData((current) => ({ ...current, leads: current.leads.map((lead) => lead.id === id ? { ...lead, ...patch } : lead) }))} removeLead={(id) => setData((current) => ({ ...current, leads: current.leads.filter((lead) => lead.id !== id) }))} goDemand={() => setView('demand')} />}
        {view === 'content' && <ContentStudio key={project.id} drafts={drafts} project={project} patchProject={patchProject} addDrafts={addDrafts} updateDraft={(id, patch) => setData((current) => ({ ...current, drafts: current.drafts.map((draft) => draft.id === id ? { ...draft, ...patch } : draft) }))} removeDraft={(id) => setData((current) => ({ ...current, drafts: current.drafts.filter((draft) => draft.id !== id) }))} setToast={setToast} />}
        {view === 'settings' && <SettingsView project={project} patchProject={patchProject} exportData={exportData} browserOpen={browserOpen} openBrowser={openBrowser} apiError={apiError} />}
      </div>
    </main>

    {modal === 'project-switch' && <Modal title="Твои идеи" subtitle="Выбери рабочую идею или начни проверку новой." onClose={() => setModal(null)}><div className="project-list">{data.projects.map((item) => <button key={item.id} className={`project-option ${item.id === project.id ? 'selected' : ''}`} onClick={() => { setData((current) => ({ ...current, activeProjectId: item.id })); setScanResults([]); setModal(null); setView('overview') }}><span className="project-avatar">{item.name.charAt(0).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.idea || 'Описание ещё не добавлено'}</small></span>{item.id === project.id && <Check size={18} />}</button>)}</div><button className="button button-primary full-width" onClick={() => setModal('new-project')}><Plus size={17} /> Новая идея</button></Modal>}
    {modal === 'new-project' && <ProjectForm title="Новая идея" submitLabel="Создать идею" onClose={() => setModal(null)} onSubmit={(form) => { if (createProject(form)) setModal(null) }} />}
    {modal === 'edit-project' && <ProjectForm title="Настроить идею" submitLabel="Сохранить изменения" initial={project} onClose={() => setModal(null)} onSubmit={(form) => { patchProject(form); setModal(null); setToast('Идея обновлена') }} />}
    {modal === 'manual-evidence' && <EvidenceForm onClose={() => setModal(null)} onSubmit={(entry) => { if (addEvidence(entry)) setModal(null) }} />}
    {modal === 'help' && <Modal title="Как работает Искра" subtitle="От гипотезы к первому контакту — шаг за шагом." onClose={() => setModal(null)}><div className="help-list"><HelpStep n="1" title="Опиши идею" text="Назови нишу, аудиторию и регион. Для каждой идеи будет свой список находок." /><HelpStep n="2" title="Ищи свежие обсуждения" text="Добавь точные слова людей. Открой Threads в отдельном окне, войди в свой аккаунт и запусти локальный поиск." /><HelpStep n="3" title="Проверь находки" text="Сохрани подходящие публикации, выдели запросы и перенеси их в список лидов." /><HelpStep n="4" title="Подготовь контакт" text="Создай черновик ответа или поста. Публикация остаётся под твоим контролем." /></div><div className="notice-box"><ShieldCheck size={19} /><span>Искра не запрашивает пароль Threads. Сессия браузера хранится только на твоём компьютере.</span></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={16} /> {toast}</div>}
  </div>
}

function Metric({ icon: Icon, label, value, detail, tone }) { return <div className="metric"><span className={`metric-icon ${tone}`}><Icon size={19} strokeWidth={1.8} /></span><div><div className="metric-label">{label}</div><div className="metric-value">{value}<span>{detail}</span></div></div></div> }
function WorkflowCard({ number, icon: Icon, title, text, action, onClick, active }) { return <button className={`workflow-card ${active ? 'highlight' : ''}`} onClick={onClick}><div className="workflow-top"><span className="workflow-icon"><Icon size={21} strokeWidth={1.8} /></span><span className="workflow-number">{number}</span></div><h3>{title}</h3><p>{text}</p><span className="workflow-action">{action} <ArrowUpRight size={17} /></span></button> }
function HelpStep({ n, title, text }) { return <div className="help-step"><span>{n}</span><div><strong>{title}</strong><p>{text}</p></div></div> }

function ProjectForm({ title, submitLabel, initial, onClose, onSubmit }) {
  const [form, setForm] = useState({ name: initial?.name || '', idea: initial?.idea || '', audience: initial?.audience || '', region: initial?.region || '' })
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  return <Modal title={title} subtitle="Можно начать с короткой гипотезы и уточнять её по ходу поиска." onClose={onClose}><form className="stack-form" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(form) }}><label>Название идеи<input autoFocus required value={form.name} onChange={change('name')} placeholder="Например, школа программирования" /></label><label>Что предлагаешь<textarea className="resize-none" rows="3" value={form.idea} onChange={change('idea')} placeholder="Коротко опиши продукт или услугу" /></label><div className="form-row"><label>Для кого<input value={form.audience} onChange={change('audience')} placeholder="Родители детей 10–16 лет" /></label><label>Регион<input value={form.region} onChange={change('region')} placeholder="Алматы" /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit">{submitLabel} <ArrowRight size={16} /></button></div></form></Modal>
}

function EvidenceForm({ onClose, onSubmit }) {
  const [entry, setEntry] = useState({ url: '', text: '', query: '', username: '', category: 'Запрос' })
  const change = (key) => (event) => setEntry((current) => ({ ...current, [key]: event.target.value }))
  return <Modal title="Сохранить публикацию" subtitle="Добавь конкретный пост, который помогает проверить твою гипотезу." onClose={onClose}><form className="stack-form" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(entry) }}><label>Ссылка на пост Threads<input autoFocus required type="url" value={entry.url} onChange={change('url')} placeholder="https://www.threads.com/@user/post/..." /></label><label>Что написал человек<textarea className="resize-none" rows="4" value={entry.text} onChange={change('text')} placeholder="Вставь ключевую мысль из публикации" /></label><div className="form-row"><label>Тип сигнала<select value={entry.category} onChange={change('category')}><option>Запрос</option><option>Обсуждение</option><option>Конкурент</option></select></label><label>Поисковая фраза<input value={entry.query} onChange={change('query')} placeholder="Необязательно" /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit">Сохранить пост</button></div></form></Modal>
}

function DemandView({ project, patchProject, evidence, addEvidence, promoteLead, leads, scanResults, scanInfo, apiError, browserOpen, scanning, openBrowser, runScan, watch, watchInterval, setWatchInterval, toggleWatch, setModal, setToast }) {
  const [newPhrase, setNewPhrase] = useState('')
  const [showDiscussions, setShowDiscussions] = useState(false)
  const [showExcluded, setShowExcluded] = useState(false)
  const active = project.phrases.filter((item) => item.enabled && item.text.trim())
  const recentPosts = scanResults.filter((post) => isRecentPost(post, project)).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
  const oldCount = scanResults.length - recentPosts.length
  const assessedResults = recentPosts.map((post) => ({ ...post, assessment: assessPost(post, project) }))
  const relevantResults = assessedResults.filter((post) => post.assessment.relevant)
  const requestResults = relevantResults.filter((post) => post.assessment.category === 'Запрос')
  const discussionCount = relevantResults.length - requestResults.length
  const excludedCount = assessedResults.length - relevantResults.length
  const visibleResults = showExcluded ? assessedResults.filter((post) => !post.assessment.relevant) : showDiscussions ? relevantResults : requestResults
  const savedUrls = new Set(evidence.map((item) => item.url))
  const leadEvidenceIds = new Set(leads.map((item) => item.evidenceId))
  const addPhrase = () => {
    const text = newPhrase.trim()
    if (!text) return
    if (project.phrases.some((item) => item.text.toLowerCase() === text.toLowerCase())) return setToast('Такая фраза уже есть')
    patchProject({ phrases: [...project.phrases, { id: uid(), text, enabled: true }] })
    setNewPhrase('')
  }
  const updatePhrase = (id, patch) => patchProject({ phrases: project.phrases.map((item) => item.id === id ? { ...item, ...patch } : item) })
  const removePhrase = (id) => patchProject({ phrases: project.phrases.filter((item) => item.id !== id) })
  const templates = [project.name, `ищу ${project.name.toLowerCase()}`, `посоветуйте ${project.name.toLowerCase()}`].filter(Boolean)
  return <>
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ШАГ 01 / ИССЛЕДОВАНИЕ</div><h1>Проверь спрос<span className="heading-dot">.</span></h1><p>Найди реальные вопросы и разговоры, которые подтверждают потребность в твоей идее.</p></div><button className="button button-secondary" onClick={() => setModal('manual-evidence')}><Plus size={17} /> Добавить пост</button></div>
    <div className="demand-layout"><div className="demand-main">
      <section className="panel phrase-panel"><div className="panel-header"><div><div className="section-kicker">01 · ФОРМУЛИРОВКИ</div><h2>Что люди пишут в поиске?</h2><p>Добавь слова клиента, а не только название своего продукта.</p></div><span className="count-pill">{active.length} активных</span></div>
        <div className="phrase-list">{project.phrases.map((item) => <div className={`phrase-row ${item.enabled ? '' : 'muted'}`} key={item.id}><input type="checkbox" checked={item.enabled} onChange={(event) => updatePhrase(item.id, { enabled: event.target.checked })} aria-label={`Использовать фразу ${item.text}`} /><input className="phrase-input" value={item.text} onChange={(event) => updatePhrase(item.id, { text: event.target.value })} aria-label="Поисковая фраза" /><a href={searchUrl(item.text)} target="_blank" rel="noreferrer" className="phrase-open" title="Открыть в Threads"><ExternalLink size={17} /></a><IconButton icon={Trash2} label="Удалить фразу" onClick={() => removePhrase(item.id)} /></div>)}{project.phrases.length === 0 && <div className="empty-inline">Пока нет фраз. Начни с того, как клиент описал бы свою задачу.</div>}</div>
        <div className="add-phrase"><Plus size={18} /><input value={newPhrase} onChange={(event) => setNewPhrase(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addPhrase() }} placeholder="Добавить свою поисковую фразу..." aria-label="Новая поисковая фраза" /><button onClick={addPhrase} disabled={!newPhrase.trim()}>Добавить</button></div>
        {project.phrases.length === 0 && <div className="suggestions"><span>Начать с примеров:</span>{templates.map((text) => <button key={text} onClick={() => patchProject({ phrases: [...project.phrases, { id: uid(), text, enabled: true }] })}>{text} <Plus size={13} /></button>)}</div>}
        <div className="relevance-settings"><div><strong>Фильтр найденных постов</strong><p>Показываем свежие запросы, где в тексте поста есть тема и аудитория. Слова или части слов — через запятую.</p></div><label>Тема<input value={topicWordsFor(project)} onChange={(event) => patchProject({ topicWords: event.target.value })} placeholder="Например: программир, кодинг, python" /></label><label>Аудитория<input value={audienceWordsFor(project)} onChange={(event) => patchProject({ audienceWords: event.target.value })} placeholder="Например: ребен, подрост, школьник" /></label><label>Период<select value={ageDaysFor(project)} onChange={(event) => patchProject({ maxAgeDays: Number(event.target.value) })}><option value="1">Последние 24 часа</option><option value="7">Последние 7 дней</option><option value="30">Последние 30 дней</option></select></label></div>
      </section>
      <section className="panel scan-panel"><div className="panel-header"><div><div className="section-kicker">02 · ПОИСК</div><h2>Запусти поиск в Threads</h2><p>Браузер последовательно откроет свежую выдачу по активным фразам.</p></div><span className={`connection-badge ${browserOpen ? 'connected' : ''}`}><span /> {browserOpen ? 'Браузер открыт' : 'Не подключён'}</span></div>
        {project.region && <label className="region-option"><input type="checkbox" checked={Boolean(project.includeRegion)} onChange={(event) => patchProject({ includeRegion: event.target.checked })} /> Добавлять «{project.region}» к запросам</label>}
        <div className="scan-actions"><button className="button button-secondary" onClick={openBrowser}><ExternalLink size={17} /> {browserOpen ? 'Открыть Threads' : 'Открыть браузер'}</button><button className="button button-primary" onClick={runScan} disabled={scanning || !active.length}>{scanning ? <LoaderCircle className="spin" size={17} /> : <Radar size={17} />} {scanning ? 'Идёт поиск…' : 'Найти публикации'}</button></div><p className="subtle-note"><ShieldCheck size={15} /> Войди в Threads в отдельном окне. Логин и пароль приложение не получает.</p>{active.length > 8 && <p className="warning-note">За один запуск проверяются первые 8 активных фраз.</p>}{apiError && <div className="error-box">{apiError}</div>}</section>
      <section className="panel watch-panel"><div className="panel-header"><div><div className="section-kicker">АВТОМАТИЗАЦИЯ</div><h2>Следить за новыми постами</h2><p>Пока приложение запущено, поиск будет повторяться через заданный интервал.</p></div><span className={`connection-badge ${watch?.enabled && watch.projectId === project.id ? 'connected' : ''}`}><span /> {watch?.enabled && watch.projectId === project.id ? 'Активно' : 'Выключено'}</span></div><div className="watch-controls"><label>Проверять каждые <select value={watchInterval} onChange={(event) => setWatchInterval(Number(event.target.value))}><option value="30">30 минут</option><option value="60">1 час</option><option value="180">3 часа</option><option value="360">6 часов</option></select></label><button className={`button ${watch?.enabled && watch.projectId === project.id ? 'button-secondary' : 'button-primary'}`} onClick={toggleWatch} disabled={!active.length && !(watch?.enabled && watch.projectId === project.id)}>{watch?.enabled && watch.projectId === project.id ? 'Остановить' : 'Включить наблюдение'}</button></div>{watch?.enabled && watch.projectId === project.id && <p className="subtle-note"><Clock3 size={15} /> Следующая проверка: {dateTimeText(watch.nextRunAt)}. Результаты сохраняются на этом компьютере.</p>}{watch?.lastError && watch.projectId === project.id && <div className="error-box">Последняя проверка: {watch.lastError}</div>}</section>
      <section className="panel results-panel">
        <div className="panel-header">
          <div>
            <div className="section-kicker">03 · РЕЗУЛЬТАТЫ</div>
            <h2>{showExcluded ? 'Отсеянные публикации' : 'Подходящие публикации'}</h2>
            <p>{scanResults.length ? `За ${ageDaysFor(project)} дн.: запросы ${requestResults.length} · обсуждения ${discussionCount} · не по теме ${excludedCount} · вне периода/без даты ${oldCount}` : 'После поиска результаты появятся здесь для просмотра.'}</p>
          </div>
          <div className="result-filter-actions">
            {showExcluded ? <button className="button button-secondary button-small" onClick={() => setShowExcluded(false)}>К подходящим</button> : <>
              {discussionCount > 0 && <button className="button button-secondary button-small" onClick={() => setShowDiscussions(!showDiscussions)}>{showDiscussions ? 'Скрыть обсуждения' : `Показать обсуждения (${discussionCount})`}</button>}
              {excludedCount > 0 && <button className="button button-secondary button-small" onClick={() => setShowExcluded(true)}>{`Проверить фильтр (${excludedCount})`}</button>}
            </>}
          </div>
        </div>
        {showExcluded && <p className="filter-review-note">Эти посты не считаются лидами и не подтверждают спрос. Здесь можно проверить, почему фильтр их скрыл.</p>}
        {visibleResults.length ? <div className="result-list">{visibleResults.map((post) => <article className={`result-card ${post.assessment.relevant ? '' : 'result-excluded'}`} key={post.url}>
          <div className="result-meta"><span className="user-chip">@{post.username || 'автор'}</span><span className="dot-separator">·</span><span>Поиск: {post.query}</span><span className={`signal-tag ${post.assessment.category === 'Запрос' ? 'request' : ''}`}>{post.assessment.relevant ? post.assessment.category : `Не подходит: ${post.assessment.reason}`}</span></div>
          <p>{post.text}</p>
          <div className="result-actions"><a href={post.url} target="_blank" rel="noreferrer">Открыть пост <ArrowUpRight size={15} /></a>{post.assessment.relevant && <button disabled={savedUrls.has(post.url)} onClick={() => addEvidence({ ...post, category: post.assessment.category })}>{savedUrls.has(post.url) ? <><Check size={15} /> Сохранено</> : <><Plus size={15} /> Сохранить</>}</button>}</div>
        </article>)}</div> : <div className="empty-state compact"><div className="empty-art"><Search size={27} /></div><h3>{showExcluded ? 'Отсеянных постов нет' : scanResults.length ? 'Подходящих запросов пока нет' : 'Здесь появятся находки'}</h3><p>{showExcluded ? 'Все свежие посты прошли фильтр.' : scanResults.length ? 'За выбранный период нет явных запросов по этой теме от нужной аудитории. Попробуй другой период или посмотри обсуждения.' : 'Добавь фразы и запусти поиск. Если Threads ничего не покажет, открой фразы вручную и сохрани пост по ссылке.'}</p></div>}
      </section>
      <section className="panel evidence-panel"><div className="panel-header"><div><div className="section-kicker">04 · ДОКАЗАТЕЛЬСТВА</div><h2>Сохранённые сигналы</h2><p>Смотри, повторяется ли задача у разных людей.</p></div><span className="count-pill">{evidence.length}</span></div>{evidence.length ? <div className="evidence-list">{evidence.map((item) => <article className="evidence-row" key={item.id}><div className="evidence-icon"><Link2 size={17} /></div><div className="evidence-body"><div><span className={`signal-tag ${item.category === 'Запрос' ? 'request' : ''}`}>{item.category}</span><span className="evidence-date">{dateText(item.createdAt)}</span></div><p>{item.text || 'Публикация без сохранённого текста'}</p><a href={item.url} target="_blank" rel="noreferrer">Смотреть в Threads <ArrowUpRight size={13} /></a></div><button className="button button-small" disabled={leadEvidenceIds.has(item.id)} onClick={() => promoteLead(item)}>{leadEvidenceIds.has(item.id) ? 'В лидах' : 'В лиды'} <ArrowRight size={14} /></button></article>)}</div> : <div className="empty-inline">Пока нет сохранённых постов. Отмечай только те, которые действительно говорят о потребности.</div>}</section>
    </div><aside className="demand-side"><div className="side-card tip-card"><div className="tip-symbol">✳</div><h3>Ищи намерение, а не популярность</h3><p>«Нужен репетитор» полезнее тысячи лайков под общим постом об образовании.</p><div className="tip-divider" /><div className="tip-example"><span>Хороший запрос</span><strong>«Посоветуйте, где ребёнку изучать Python?»</strong></div></div><div className="side-card browser-card"><div className="side-card-icon"><Clock3 size={19} /></div><h3>Свежая выдача</h3><p>Поиск открывается на вкладке недавних публикаций. Порядок и полноту результатов определяет Threads.</p></div></aside></div>
  </>
}

function LeadsView({ leads, filter, setFilter, updateLead, removeLead, goDemand }) {
  const visible = filter === 'all' ? leads : leads.filter((item) => item.status === filter)
  return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ШАГ 02 / КОНТАКТЫ</div><h1>Потенциальные лиды<span className="heading-dot">.</span></h1><p>Люди, чьи публичные вопросы могут быть связаны с твоим предложением.</p></div></div><div className="toolbar"><div className="filter-tabs" role="group" aria-label="Фильтр лидов">{[['all', 'Все'], ...Object.entries(STATUS_LABELS)].map(([id, label]) => <button key={id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div><span className="toolbar-count">{visible.length} из {leads.length}</span></div>{visible.length ? <div className="lead-grid">{visible.map((lead) => <article className="lead-card" key={lead.id}><div className="lead-card-top"><div className="lead-avatar">{(lead.username || '?').charAt(0).toUpperCase()}</div><div><strong>{lead.username ? `@${lead.username}` : 'Автор поста'}</strong><small>Добавлен {dateText(lead.createdAt)}</small></div><select value={lead.status} onChange={(event) => updateLead(lead.id, { status: event.target.value })} aria-label="Статус лида">{Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div><p className="lead-quote">{lead.text || 'Текст поста не сохранён.'}</p><textarea className="resize-none" value={lead.note} onChange={(event) => updateLead(lead.id, { note: event.target.value })} placeholder="Заметка: что предложить и когда вернуться..." aria-label="Заметка о лиде" rows="2" /><div className="lead-card-bottom"><a href={lead.url} target="_blank" rel="noreferrer">Открыть в Threads <ArrowUpRight size={15} /></a><IconButton icon={Trash2} label="Удалить лид" onClick={() => { if (confirm('Удалить этот лид из списка?')) removeLead(lead.id) }} /></div></article>)}</div> : <div className="empty-state large"><div className="empty-art"><Inbox size={29} /></div><h3>{leads.length ? 'В этой категории пока пусто' : 'Лиды появятся здесь'}</h3><p>Сохрани пост с конкретной потребностью и нажми «В лиды».</p><button className="button button-primary" onClick={goDemand}>Перейти к поиску <ArrowRight size={16} /></button></div>}</>
}

function ContentView({ drafts, project, generateDraft, updateDraft, removeDraft, setToast }) {
  const copy = async (text) => { await navigator.clipboard.writeText(text); setToast('Текст скопирован') }
  return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ШАГ 03 / КОММУНИКАЦИЯ</div><h1>Контент и ответы<span className="heading-dot">.</span></h1><p>Подготовь публикацию или личный ответ. Перед отправкой проверь тон и факты.</p></div></div><div className="content-starter"><div className="starter-icon"><Sparkles size={23} /></div><div><h2>С чего начнём?</h2><p>Создай основу текста из описания идеи «{project.name}», затем отредактируй её.</p></div><div className="starter-actions"><button className="button button-secondary" onClick={() => generateDraft('reply')}><Plus size={16} /> Ответ на запрос</button><button className="button button-primary" onClick={() => generateDraft('post')}><Plus size={16} /> Пост для Threads</button></div></div>{drafts.length ? <div className="draft-grid">{drafts.map((draft) => <article className="panel draft-card" key={draft.id}><div className="draft-head"><span className={`draft-type ${draft.type}`}>{draft.type === 'post' ? 'Пост' : 'Ответ'}</span><span>{dateText(draft.createdAt)}</span></div><input className="draft-title" value={draft.title} onChange={(event) => updateDraft(draft.id, { title: event.target.value })} aria-label="Название черновика" /><textarea className="resize-none" value={draft.text} onChange={(event) => updateDraft(draft.id, { text: event.target.value })} aria-label="Текст черновика" rows="10" /><div className="draft-bottom"><span>{draft.text.length} символов · черновик</span><div><IconButton icon={Trash2} label="Удалить черновик" onClick={() => { if (confirm('Удалить этот черновик?')) removeDraft(draft.id) }} /><button className="button button-small" onClick={() => copy(draft.text)}><Copy size={15} /> Скопировать</button></div></div></article>)}</div> : <div className="empty-state large"><div className="empty-art"><FileText size={29} /></div><h3>Черновиков пока нет</h3><p>Начни с ответа на конкретный вопрос или поста о проблеме своей аудитории.</p></div>}<div className="notice-box content-notice"><ShieldCheck size={19} /><span>Тексты создаются как шаблоны на твоём компьютере. Приложение не публикует их в Threads без твоего действия.</span></div></>
}

function SettingsView({ project, patchProject, exportData, browserOpen, openBrowser, apiError }) {
  return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> РАБОЧЕЕ ПРОСТРАНСТВО</div><h1>Настройки<span className="heading-dot">.</span></h1><p>Данные идеи, локальный браузер и экспорт результатов.</p></div></div><div className="settings-grid"><section className="panel settings-panel"><div className="section-kicker">ОБ ИДЕЕ</div><h2>{project.name}</h2><label>Короткое описание<textarea className="resize-none" rows="4" value={project.idea} onChange={(event) => patchProject({ idea: event.target.value })} placeholder="Что ты предлагаешь?" /></label><label>Аудитория<input value={project.audience} onChange={(event) => patchProject({ audience: event.target.value })} placeholder="Кому это нужно?" /></label><label>Регион<input value={project.region} onChange={(event) => patchProject({ region: event.target.value })} placeholder="Город или страна" /></label><p className="settings-hint"><CheckCheck size={15} /> Изменения сохраняются автоматически.</p></section><div className="settings-side"><section className="panel settings-panel"><div className="section-kicker">ЛОКАЛЬНЫЙ БРАУЗЕР</div><h2>Threads</h2><p>Поиск использует отдельное окно браузера и сохраняет его сессию только на твоём компьютере.</p><div className={`connection-line ${browserOpen ? 'on' : ''}`}><span /> {browserOpen ? 'Окно браузера открыто' : 'Окно браузера закрыто'}</div><button className="button button-secondary" onClick={openBrowser}><ExternalLink size={16} /> Открыть Threads</button>{apiError && <div className="error-box">{apiError}</div>}</section><section className="panel settings-panel"><div className="section-kicker">ТВОИ ДАННЫЕ</div><h2>Резервная копия</h2><p>Экспортируй идеи, сохранённые посты, лидов и черновики в один JSON-файл.</p><button className="button button-secondary" onClick={exportData}><Download size={16} /> Скачать данные</button></section></div></div></>
}

export default App
