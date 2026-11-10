import test from 'node:test';
import assert from 'node:assert/strict';
import { defineLayout, uint, int, str, loctext, skip } from '../tools/dbc/layout.js';
import { createTableSql, dropTableSql, insertSql } from '../tools/dbc/schema.js';

const layout = defineLayout({
  table: 'spell_radius', file: 'SpellRadius.dbc',
  columns: [uint('id'), int('radius'), skip(), str('label')]
});

test('the first column is the primary key and skips produce no column', () => {
  const sql = createTableSql(layout);
  assert.match(sql, /CREATE TABLE `spell_radius`/);
  assert.match(sql, /`id` INT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(sql, /`radius` INT NOT NULL DEFAULT 0/);
  assert.match(sql, /`label` VARCHAR\(512\) NOT NULL DEFAULT ''/);
  assert.match(sql, /PRIMARY KEY \(`id`\)/);
  assert.match(sql, /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/);
  assert.equal(sql.includes('null'), false);
});

test('a TEXT column carries no default, because MySQL forbids one', () => {
  const withText = defineLayout({ table: 't', file: 'T.dbc', columns: [uint('id'), loctext('description')] });
  assert.match(createTableSql(withText), /`description` TEXT/);
  assert.equal(createTableSql(withText).includes("TEXT NOT NULL DEFAULT"), false);
});

test('drop is guarded', () => {
  assert.equal(dropTableSql(layout), 'DROP TABLE IF EXISTS `spell_radius`');
});

test('insert has one placeholder group per row and one placeholder per column', () => {
  const sql = insertSql(layout, 2);
  assert.match(sql, /INSERT INTO `spell_radius` \(`id`, `radius`, `label`\) VALUES/);
  assert.equal(sql.match(/\(\?, \?, \?\)/g).length, 2);
});

test('an insert of zero rows is refused rather than producing invalid SQL', () => {
  assert.throws(() => insertSql(layout, 0), /at least one row/);
});
