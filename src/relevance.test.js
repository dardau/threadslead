import test from 'node:test'
import assert from 'node:assert/strict'
import { assessPost, isRecentPost } from './relevance.js'

const project = { id: 'demo-school' }
const fresh = new Date().toISOString()
const post = (text, timestamp = fresh) => ({ text, timestamp })

test('shows a timely request about the course and the intended child audience', () => {
  assert.deepEqual(assessPost(post('Посоветуйте курсы программирования для ребёнка 12 лет в Алматы'), project), { relevant: true, category: 'Запрос' })
})

test('does not treat the search phrase as evidence when the post is off topic', () => {
  assert.equal(assessPost(post('Ищу няню для ребёнка в Алматы'), project).relevant, false)
  assert.equal(assessPost(post('Вакансия: личный ассистент предпринимателя'), project).relevant, false)
  assert.equal(assessPost(post('Посоветуйте психолога в Алматы'), project).relevant, false)
})

test('does not label old posts or provider posts as active leads', () => {
  assert.equal(assessPost(post('Посоветуйте курсы программирования для ребенка', '2025-05-05T00:00:00Z'), project).relevant, false)
  assert.notEqual(assessPost(post('Школа программирования для детей открыла набор'), project).category, 'Запрос')
})

test('defaults to seven days and lets a project expand to thirty', () => {
  const tenDaysOld = post('Посоветуйте курсы программирования для ребенка', new Date(Date.now() - 10 * 86400000).toISOString())
  assert.equal(isRecentPost(tenDaysOld, project), false)
  assert.equal(isRecentPost(tenDaysOld, { ...project, maxAgeDays: 30 }), true)
  assert.equal(isRecentPost(post('Без даты', ''), project), false)
})
