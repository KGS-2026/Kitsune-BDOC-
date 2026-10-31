const test = require('node:test');
const assert = require('node:assert');
const { parseRow, addReport, finishDay, theaterOf } = require('../netlify/functions/_lib/incidents.js');

function row(over) {
  const c = new Array(61).fill('');
  Object.assign(c, { 1: '20261031', 26: '195', 28: '19', 30: '-10', 31: '4', 32: '2', 51: '4',
    52: 'Bandar Abbas, Hormozgan, Iran', 53: 'IR', 56: '27.1865', 57: '56.2808', 60: 'https://a.test/1' }, over);
  return c.join('\t');
}

test('a located strike parses, rounded to two decimals', () => {
  const r = parseRow(row({}), '20261031');
  assert.equal(r.code, '195');
  assert.equal(r.lat, 27.19);
  assert.equal(r.prec, 'city');
});

test('province-level geocodes are kept and labelled region', () => {
  assert.equal(parseRow(row({ 51: '5' }), '20261031').prec, 'region');
});

test('country centroids, peaceful codes and old retellings are dropped', () => {
  assert.equal(parseRow(row({ 51: '1' }), '20261031'), null);
  assert.equal(parseRow(row({ 28: '04' }), '20261031'), null);
  assert.equal(parseRow(row({ 1: '20251031' }), '20261031'), null);
  assert.equal(parseRow(row({ 30: '2' }), '20261031'), null);
});

test('same type, place and day collapse, and distinct URLs count as articles', () => {
  const day = new Map();
  addReport(day, parseRow(row({}), '20261031'));
  addReport(day, parseRow(row({ 60: 'https://b.test/2', 31: '9' }), '20261031'));
  addReport(day, parseRow(row({ 60: 'https://b.test/2' }), '20261031'));
  const [e] = finishDay(day);
  assert.equal(finishDay(day).length, 1);
  assert.equal(e.a, 2);
  assert.equal(e.m, 17);
  assert.equal(e.url, 'https://b.test/2');
});

test('theaters: Hormuz is iran, Beirut levant, Lima world', () => {
  assert.equal(theaterOf(26.57, 56.25), 'iran');
  assert.equal(theaterOf(33.89, 35.5), 'levant');
  assert.equal(theaterOf(-12, -77), 'world');
});
