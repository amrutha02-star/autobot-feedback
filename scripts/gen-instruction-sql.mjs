// Writes supabase/instruction.sql: stores Autobot's logging instruction in the database.
// Run after changing src/instruction.ts:  node scripts/gen-instruction-sql.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { buildInstruction } from '../src/instruction.ts'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const url = env.VITE_SUPABASE_URL.replace(/\/$/, '')
const text = buildInstruction({
  projectRef: url.match(/https:\/\/([^.]+)\./)[1],
  dropBoxUrl: `${url}/functions/v1/hyper-task`,
  anonKey: env.VITE_SUPABASE_ANON_KEY,
  uploadKey: '__UPLOAD_KEY__',
})
if (text.includes('$instr$')) throw new Error('Instruction contains the quote tag')

const sql = `-- Autobot's logging instruction, read live by Autobot:  select public.logging_instruction();
-- Generated from src/instruction.ts on ${new Date().toISOString().slice(0, 10)}. Safe to re-run.
create or replace function public.logging_instruction() returns text
language sql stable security definer set search_path = public as $fn$
  select replace(replace(replace($instr$${text}$instr$,
    '__UPLOAD_KEY__',   (select value from public.app_secrets where name = 'upload_key')),
    '__DRIVE_URL__',    coalesce((select value from public.app_settings where name = 'drive_script_url'), 'NOT SET UP')),
    '__DRIVE_SECRET__', coalesce((select value from public.app_settings where name = 'drive_secret'), 'NOT SET UP'))
$fn$;
-- Only Autobot's server-side Supabase connection may read it (it contains the drop-box key).
revoke execute on function public.logging_instruction() from public, anon, authenticated;

select 'Autobot instruction stored ✓ (' || length(public.logging_instruction()) || ' characters)' as status;
`
writeFileSync(new URL('../supabase/instruction.sql', import.meta.url), sql)
console.log('wrote supabase/instruction.sql,', text.length, 'chars')
