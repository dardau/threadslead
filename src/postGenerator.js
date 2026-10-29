export const NARXOZ_BRIEF = {
  name: 'Narxoz AI Juniors',
  audience: 'родители школьников 11–16 лет',
  city: 'Алматы',
  offer: 'очный ИИ-интенсив: ребёнок создаст небольшие сайт или приложение, веб-игру и ИИ-ассистента с помощью преподавателя и наставников',
  result: 'свою веб-игру, сайт или приложение и ИИ-ассистента',
  differentiator: 'Можно прийти без опыта. Компьютеры и доступ к ИИ-инструментам предоставляем.',
  dates: '9–14 ноября',
  price: '119 000 ₸',
  cta: 'Напишите «ПРОЕКТ» — отправим программу.',
  confirmDates: false,
  confirmPrice: false,
}

const clean = (value) => String(value || '').trim().replace(/\s+/g, ' ')
const end = (value) => /[.!?…]$/.test(value) ? value : `${value}.`

export function generatePosts(brief) {
  const name = clean(brief.name) || 'Наш курс'
  const city = clean(brief.city)
  const audience = clean(brief.audience) || 'родители'
  const offer = clean(brief.offer)
  const result = clean(brief.result) || 'свой первый проект'
  const difference = clean(brief.differentiator)
  const cta = end(clean(brief.cta) || 'Напишите нам — расскажем подробнее')
  const cityLead = city ? `${city}, ` : ''
  const cityLine = city ? `Очно в ${city}.` : ''
  const ageLine = audience.match(/\d+\s*[–-]\s*\d+\s*лет/i)?.[0] || ''
  const facts = [
    brief.confirmDates && clean(brief.dates) ? clean(brief.dates) : '',
    brief.confirmPrice && clean(brief.price) ? clean(brief.price) : '',
  ].filter(Boolean)
  const factsLine = facts.length ? `${facts.join(' · ')}.\n` : ''
  const offerLine = offer ? `${end(offer)}\n` : ''
  const differenceLine = difference ? `${end(difference)}\n` : ''

  return [
    {
      angle: 'Вопрос родителям',
      purpose: 'Начать разговор',
      text: `${cityLead}${audience}: чем ваш ребёнок может заниматься часами, если его не отвлекать? 👀\n\nНапишите возраст и увлечение — предложим идею первого проекта с ИИ.`,
    },
    {
      angle: 'Узнаваемая ситуация',
      purpose: 'Показать результат',
      text: `«Выйди уже из своей игры».\n\nА если однажды ребёнок ответит: «Подожди, я её доделываю»? 🙂\n\nНа ${name} дети пробуют создать ${result}. ${cityLine}`.trim(),
    },
    {
      angle: 'Сомнение про ИИ',
      purpose: 'Снять возражение',
      text: `«Если код пишет ИИ, чему тогда учится ребёнок?»\n\nПридумать идею, объяснить задачу, заметить ошибку и добиться результата — тоже работа.\n\nНа ${name} ребёнок проходит этот путь с наставником.`,
    },
    {
      angle: 'Прямой набор',
      purpose: 'Получить обращение',
      text: `${cityLead}ваш ребёнок хочет создать ${result}, но не знает, с чего начать?\n\n${name}: ${offerLine}${differenceLine}${ageLine ? `${ageLine}. ` : ''}${cityLine}\n${factsLine}\n${cta}`.replace(/\n{3,}/g, '\n\n').trim(),
    },
    {
      angle: 'Что будет на выходе',
      purpose: 'Объяснить пользу',
      text: `Самый интересный вопрос после занятий: «Покажешь, что ты сделал?»\n\nНа ${name} участники пробуют создать ${result}. В финале можно показать, как проект работает, и рассказать, что пришлось исправить.\n\n${cta}`,
    },
    {
      angle: 'Что важно родителю',
      purpose: 'Собрать обратную связь',
      text: `${audience}, что убедило бы вас записать ребёнка на такой курс?\n\nРаботающий проект? Преподаватель? Понятные условия? Или чтобы ребёнок сам сказал: «Хочу ещё»?`,
    },
  ].map((post, index) => ({ ...post, title: `${index + 1}. ${post.angle}` }))
}
