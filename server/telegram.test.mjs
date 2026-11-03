import test from 'node:test'
import assert from 'node:assert/strict'
import { TelegramBridge, formatFindings, newRelevantPosts } from './telegram.mjs'
import { assessPost } from '../src/relevance.js'

test('notification candidates are new, recent, direct requests', () => {
  const timestamp = new Date().toISOString()
  const posts = [
    { url: 'https://www.threads.com/@a/post/1', text: 'Посоветуйте курсы программирования для ребенка', timestamp },
    { url: 'https://www.threads.com/@b/post/2', text: 'Ищу няню для ребенка', timestamp },
    { url: 'https://www.threads.com/@c/post/3', text: 'Школа программирования для детей открыла набор', timestamp },
  ]
  const selected = newRelevantPosts(posts, new Set(), { id: 'demo-school' }, assessPost)
  assert.deepEqual(selected.map((post) => post.url), [posts[0].url])
  assert.equal(newRelevantPosts(posts, new Set([posts[0].url]), { id: 'demo-school' }, assessPost).length, 0)
  assert.match(formatFindings(selected), /https:\/\/www\.threads\.com\/@a\/post\/1/)
})

test('only the private chat with the pairing code can control the bot', async () => {
  const sent = []
  const commands = []
  const bridge = new TelegramBridge({ readState: async () => ({}), saveState: async () => {}, onCommand: async (command) => { commands.push(command); return 'OK' } })
  bridge.state.token = '123456:abcdefghijklmnopqrstuvwxyz'
  bridge.state.pairCode = '654321'
  bridge.api = async (method, body) => { if (method === 'sendMessage') sent.push(body); return {} }
  await bridge.handleMessage({ chat: { id: 1, type: 'private' }, text: '/start 000000' })
  assert.match(sent[0].text, /нужен код/)
  await bridge.handleMessage({ chat: { id: 2, type: 'group' }, text: '/start 654321' })
  assert.equal(bridge.state.chatId, null)
  await bridge.handleMessage({ chat: { id: 3, type: 'private' }, from: { first_name: 'Дар' }, text: '/start 654321' })
  assert.equal(bridge.state.chatId, 3)
  await bridge.handleMessage({ chat: { id: 4, type: 'private' }, text: '/pause' })
  assert.deepEqual(commands, [])
  await bridge.handleMessage({ chat: { id: 3, type: 'private' }, text: '/pause' })
  assert.deepEqual(commands, ['/pause'])
  assert.equal(sent.at(-1).chat_id, 3)
})

test('sent post links are remembered to prevent duplicate alerts', async () => {
  const messages = []
  const bridge = new TelegramBridge({ readState: async () => ({}), saveState: async () => {}, onCommand: async () => '' })
  bridge.state.chatId = 3
  bridge.state.token = '123456:abcdefghijklmnopqrstuvwxyz'
  bridge.api = async (method, body) => { if (method === 'sendMessage') messages.push(body); return {} }
  const post = { url: 'https://www.threads.com/@a/post/1', username: 'a', text: 'Ищу курс для ребёнка' }
  assert.equal(await bridge.notify([post]), 1)
  assert.equal(await bridge.notify([post]), 0)
  assert.equal(messages.length, 1)
})
