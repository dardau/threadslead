// Threads search may return posts matching only a fragment of a query. Check the
// actual post text before presenting it as evidence of demand.
const STOP_WORDS = new Set(['для', 'детей', 'ребенка', 'ребёнка', 'подростков', 'взрослых', 'людей', 'курсы', 'курс', 'школа', 'занятия', 'обучение', 'онлайн', 'офлайн', 'ищу', 'посоветуйте', 'где', 'как', 'хочу', 'на', 'по', 'и', 'в', 'с', 'из', 'алматы'])
const REQUEST = /(?:^| )(?:ищу|ищем|посоветуйте|посоветуй|подскажите|подскажи|порекомендуйте|нужен|нужна|нужны|где|какие|какой|куда|стоит ли|хочу записать|хочу научить|хотим записать)(?: |$)/i
const SALES_OR_WORK = /(?:^| )(?:ваканси[а-я]*|работу|сотрудник[а-я]*|требуется|приглашаем|возьму|набираем|открыла набор|открыли набор|набор в группу|записывайтесь|в директ|продам|услуги|разработчик по образованию)(?: |$)/i

export const DEMO_TOPIC_WORDS = 'программир, кодинг, вайбкодинг, веб-разработ, python, создание игр, разработка игр'
export const DEMO_AUDIENCE_WORDS = 'ребен, ребён, дет, подрост, школьник, сын, доч, 7–11 кл'
export const AGE_OPTIONS = [1, 7, 30]

export function ageDaysFor(project) {
  const days = Number(project.maxAgeDays)
  return AGE_OPTIONS.includes(days) ? days : 7
}

export function isRecentPost(post, project, now = Date.now()) {
  const postedAt = Date.parse(post.timestamp)
  return Number.isFinite(postedAt) && postedAt <= now + 5 * 60000 && postedAt >= now - ageDaysFor(project) * 86400000
}

function normalize(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[–—-]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function words(value) {
  return String(value || '').split(',').map(normalize).filter(Boolean)
}

function hasTerm(text, term) {
  const normalized = normalize(term)
  if (!normalized) return false
  if (normalized.includes(' ')) {
    const termWords = normalized.split(' ')
    const textWords = text.split(' ')
    return textWords.some((_, index) => termWords.every((part, offset) => textWords[index + offset]?.startsWith(part)))
  }
  return text.split(' ').some((word) => word.startsWith(normalized))
}

export function topicWordsFor(project) {
  if (typeof project.topicWords === 'string') return project.topicWords
  if (project.id === 'demo-school') return DEMO_TOPIC_WORDS
  const inferred = normalize(project.idea || project.name).split(' ').filter((word) => word.length >= 5 && !STOP_WORDS.has(word))
  return inferred.join(', ')
}

export function audienceWordsFor(project) {
  if (typeof project.audienceWords === 'string') return project.audienceWords
  if (project.id === 'demo-school') return DEMO_AUDIENCE_WORDS
  return normalize(project.audience).split(' ').filter((word) => word.length >= 4 && !STOP_WORDS.has(word)).join(', ')
}

export function assessPost(post, project) {
  const text = normalize(post.text)
  const topics = words(topicWordsFor(project))
  const audience = words(audienceWordsFor(project))
  if (!text || !topics.length) return { relevant: false, reason: 'Нет темы для проверки' }
  if (!isRecentPost(post, project)) return { relevant: false, reason: 'Вне выбранного периода или без даты' }
  if (!topics.some((term) => hasTerm(text, term))) return { relevant: false, reason: 'Нет темы в тексте поста' }
  if (audience.length && !audience.some((term) => hasTerm(text, term))) return { relevant: false, reason: 'Другая аудитория' }
  if (SALES_OR_WORK.test(text)) return { relevant: false, reason: 'Похоже на рекламу или вакансию' }
  return { relevant: true, category: REQUEST.test(text) ? 'Запрос' : 'Обсуждение' }
}
