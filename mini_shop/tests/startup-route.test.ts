import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appSource = readFileSync(resolve(import.meta.dirname, '../App.vue'), 'utf8')

test('startup redirects a stale login page to the public home page regardless of login state', () => {
  assert.match(
    appSource,
    /function ensureHomeEntry\(\): void[\s\S]*currentRoute[^\n]*pages\/login\/login[\s\S]*uni\.reLaunch\(\{[\s\S]*url: '\/pages\/index\/index'/,
  )
})

test('home remains the first page so a fresh launch does not require login', () => {
  const pagesSource = readFileSync(resolve(import.meta.dirname, '../pages.json'), 'utf8')
  const pages = JSON.parse(pagesSource) as { pages?: Array<{ path?: string }> }
  assert.equal(pages.pages?.[0]?.path, 'pages/index/index')
})
