import { useState } from 'react'
import { ArrowRight, Check, Copy, FileText, Lightbulb, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { generatePosts, NARXOZ_BRIEF } from './postGenerator.js'

const FIELDS = [
  ['name', 'Название курса или проекта', 'Narxoz AI Juniors'],
  ['audience', 'Кому адресован', 'Родители школьников 11–16 лет'],
  ['city', 'Город', 'Алматы'],
  ['offer', 'Что происходит на курсе', 'Формат, программа и помощь наставников'],
  ['result', 'Что ребёнок сделает', 'Веб-игра, сайт и ИИ-ассистент'],
  ['differentiator', 'Что снимает сомнения', 'Можно с нуля; техника предоставляется'],
  ['cta', 'Призыв к действию', 'Напишите «ПРОЕКТ» — отправим программу'],
]

const initialBrief = (project) => project.contentBrief || (project.id === 'demo-school' ? NARXOZ_BRIEF : {
  name: project.name,
  audience: project.audience || '',
  city: project.region || '',
  offer: project.idea || '',
  result: '',
  differentiator: '',
  dates: '',
  price: '',
  cta: 'Напишите нам — расскажем подробнее',
  confirmDates: false,
  confirmPrice: false,
})

export default function ContentStudio({ drafts, project, patchProject, addDrafts, updateDraft, removeDraft, setToast }) {
  const brief = initialBrief(project)
  const [preview, setPreview] = useState([])
  const [error, setError] = useState('')
  const change = (key, value) => {
    patchProject({ contentBrief: { ...brief, [key]: value } })
    setPreview([])
  }
  const generate = () => {
    if (!brief.name?.trim() || !brief.offer?.trim() || !brief.result?.trim()) {
      setError('Заполни название, описание курса и результат для ребёнка.')
      return
    }
    setError('')
    setPreview(generatePosts(brief))
  }
  const save = (post) => {
    addDrafts([{ type: 'post', title: post.title, text: post.text, purpose: post.purpose, source: 'content-studio' }])
    setToast('Вариант сохранён в черновики')
  }
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setToast('Текст скопирован') }
    catch { setToast('Не удалось скопировать. Выдели текст в черновике вручную.') }
  }
  return <>
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ШАГ 03 / КОММУНИКАЦИЯ</div><h1>Посты для Threads<span className="heading-dot">.</span></h1><p>Короткие варианты на основе твоего предложения. Выбери угол подачи и доведи текст до своего голоса.</p></div></div>
    <div className="studio-layout">
      <section className="panel studio-brief">
        <div className="studio-title"><div className="studio-title-icon"><Lightbulb size={19} /></div><div><span className="section-kicker">ОСНОВА ДЛЯ ПОСТОВ</span><h2>Что важно знать о курсе</h2></div></div>
        <p className="studio-intro">{project.id === 'demo-school' ? 'Поля заполнены по присланному материалу Narxoz AI Juniors. Измени их, если условия уже другие.' : 'Заполни факты о своём предложении. Для примера можно взять материал Narxoz AI Juniors.'}</p>
        {project.id !== 'demo-school' && <button className="button button-secondary studio-preset" onClick={() => patchProject({ contentBrief: { ...NARXOZ_BRIEF } })}>Заполнить примером Narxoz AI Juniors</button>}
        <div className="studio-fields">{FIELDS.map(([key, label, placeholder]) => <label key={key}>{label}{key === 'offer' || key === 'result' || key === 'differentiator' ? <textarea className="resize-none" rows="3" value={brief[key] || ''} placeholder={placeholder} onChange={(event) => change(key, event.target.value)} /> : <input value={brief[key] || ''} placeholder={placeholder} onChange={(event) => change(key, event.target.value)} />}</label>)}</div>
        <div className="studio-facts"><div className="studio-facts-title"><ShieldCheck size={17} /><strong>Условия перед публикацией</strong></div><p>Дата и цена из исходного текста могли измениться. Они попадут в варианты только после твоего подтверждения.</p><div className="studio-fact"><label>Даты<input value={brief.dates || ''} onChange={(event) => change('dates', event.target.value)} placeholder="Например, 9–14 ноября" /></label><label className="studio-check"><input type="checkbox" checked={Boolean(brief.confirmDates)} onChange={(event) => change('confirmDates', event.target.checked)} /> Подтверждаю даты</label></div><div className="studio-fact"><label>Стоимость<input value={brief.price || ''} onChange={(event) => change('price', event.target.value)} placeholder="Например, 119 000 ₸" /></label><label className="studio-check"><input type="checkbox" checked={Boolean(brief.confirmPrice)} onChange={(event) => change('confirmPrice', event.target.checked)} /> Подтверждаю цену</label></div></div>
        {error && <p className="studio-error" role="alert">{error}</p>}
        <button className="button button-primary studio-generate" onClick={generate}><Sparkles size={17} /> Сгенерировать 6 вариантов <ArrowRight size={16} /></button>
      </section>
      <div className="studio-right"><section className="studio-guide"><span className="studio-guide-mark">✳</span><div className="section-kicker">КАК УСТРОЕНЫ ВАРИАНТЫ</div><h3>Не шесть одинаковых анонсов</h3><p>Один пост начинает разговор, другой снимает сомнение, третий прямо приглашает узнать программу. Сравнивай не только реакции, но и обращения.</p></section><section className="panel studio-caution"><ShieldCheck size={19} /><p>Нельзя обещать, что пост «залетит». Тексты здесь — гипотезы для проверки. Публикуй после редактирования и проверки фактов.</p></section></div>
    </div>
    <section className="studio-output"><div className="studio-section-head"><div><span className="section-kicker">ВАРИАНТЫ ДЛЯ ПРОСМОТРА</span><h2>Выбери подачу</h2></div>{preview.length > 0 && <button className="button button-secondary" onClick={generate}><RefreshCw size={15} /> Обновить из полей</button>}</div>
      {preview.length ? <div className="studio-preview-grid">{preview.map((post) => <article className="studio-post" key={post.angle}><div className="studio-post-meta"><span>{post.angle}</span><small>{post.purpose}</small></div><textarea className="resize-none" aria-label={`Текст варианта: ${post.angle}`} value={post.text} onChange={(event) => setPreview((current) => current.map((item) => item.angle === post.angle ? { ...item, text: event.target.value } : item))} /><div className="studio-post-actions"><span>{post.text.length} символов</span><button onClick={() => save(post)}><Plus size={15} /> В черновики</button></div></article>)}</div> : <div className="studio-placeholder"><div><Sparkles size={26} /></div><h3>Варианты появятся здесь</h3><p>Проверь основу слева и нажми «Сгенерировать 6 вариантов».</p></div>}</section>
    <section className="studio-output"><div className="studio-section-head"><div><span className="section-kicker">СОХРАНЕНО</span><h2>Твои черновики <span className="studio-count">{drafts.length}</span></h2></div></div>
      {drafts.length ? <div className="studio-preview-grid">{drafts.map((draft) => <article className="studio-post saved" key={draft.id}><div className="studio-post-meta"><span>{draft.title}</span><small>{draft.purpose || 'Черновик'}</small></div><textarea className="resize-none" aria-label={`Черновик: ${draft.title}`} value={draft.text} onChange={(event) => updateDraft(draft.id, { text: event.target.value })} /><div className="studio-post-actions"><span>{draft.text.length} символов</span><div><button onClick={() => copy(draft.text)}><Copy size={15} /> Копировать</button><button className="studio-delete" onClick={() => removeDraft(draft.id)} aria-label={`Удалить черновик ${draft.title}`}><Trash2 size={15} /></button></div></div></article>)}</div> : <div className="studio-placeholder small"><FileText size={22} /><p>Сохрани понравившийся вариант, чтобы вернуться к нему позже.</p></div>}
    </section>
  </>
}
