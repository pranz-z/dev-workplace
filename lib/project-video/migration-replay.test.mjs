import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('current-base 24-migration replay plus unchanged video migration in disposable PGlite', async () => {
  const runtime = process.env.PORTFOLIO_TEST_PGLITE_MODULE;
  assert.ok(runtime, 'PORTFOLIO_TEST_PGLITE_MODULE must identify the existing disposable runtime');
  const { PGlite } = await import(pathToFileURL(runtime).href);
  const { btree_gist } = await import(pathToFileURL(runtime.replace(/index\.js$/, 'contrib/btree_gist.js')).href);
  const db = new PGlite({ extensions: { btree_gist } });
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  const videoMigration = '20261025152931_project_preview_videos.sql';
  const baseline = readdirSync(directory).filter(name => name.endsWith('.sql') && name !== videoMigration).sort();
  assert.equal(baseline.length, 24);
  try {
    // Supabase-managed Auth/Storage schemas are platform fixtures, not application migrations.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth, storage to anon, authenticated, service_role;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;`);
    for (const name of [...baseline, videoMigration]) {
      let sql = readFileSync(new URL(name, directory), 'utf8');
      // PGlite has core gen_random_uuid(), but does not distribute pgcrypto.
      // Only its unavailable extension-install statement is omitted in memory.
      if (name === '20260930120000_phase1.sql') sql = sql.replace('create extension if not exists "pgcrypto";', '');
      try { await db.exec(sql); }
      catch (error) { throw new Error(`Migration replay failed: ${name}: ${error.message}`, { cause: error }); }
    }
    await db.exec(`insert into auth.users values('${owner}'),('${other}');
      insert into public.profiles(id,display_name,public_profile_enabled) values('${owner}','Owner',true);
      update private.portfolio_site_config set owner_id='${owner}' where singleton;
      insert into public.projects(id,user_id,slug,title,visibility) values('${project}','${owner}','replay-project','Replay project','Private');`);
    const as = async (role, user = '') => db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); set role ${role};`);
    const rpc = async (action, input = {}) => (await db.query('select public.manage_project_preview_video($1,$2,$3,$4::jsonb) as result', [owner, project, action, JSON.stringify(input)])).rows[0].result;
    const pathname = 'portfolio-previews/' + 'a'.repeat(48) + '.mp4';
    await as('service_role');
    const upload = await rpc('begin', { pathname, name: 'preview.mp4', type: 'video/mp4', size: 10485760 });
    const result = await rpc('finalize', { ...upload, pathname, mimeType: 'video/mp4', sizeBytes: 10485760 });
    assert.equal(result.video.enabled, false);
    await rpc('enabled', { enabled: true });
    await as('anon');
    const resolve = async () => (await db.query("select * from public.public_project_preview_video('replay-project')")).rows;
    assert.equal((await resolve()).length, 0);
    await assert.rejects(db.query('select * from public.project_preview_videos'), /permission denied/);
    await as('postgres');
    await db.exec(`update public.projects set visibility='Public' where id='${project}'`);
    await as('anon');
    assert.equal((await resolve())[0].blob_pathname, pathname);
    await as('postgres');
    await db.exec(`insert into public.project_screenshots(id,user_id,project_id,storage_path,is_public,sort_order) values
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${owner}','${project}','${owner}/${project}/first.png',true,1),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${owner}','${project}','${owner}/${project}/second.png',false,0);`);
    await as('anon');
    const covers = async () => (await db.query('select * from public.public_project_screenshots(null)')).rows;
    assert.match((await covers())[0].storage_path, /first\.png$/);
    await as('authenticated', owner);
    await db.exec("update public.project_screenshots set is_public=true where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'");
    await as('anon');
    assert.match((await covers())[0].storage_path, /second\.png$/);
    assert.equal((await db.query("select * from public.public_project_screenshots('replay-project')")).rows.length, 2);
    await as('authenticated', owner);
    await db.exec("update public.project_screenshots set sort_order=2 where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'");
    await as('anon');
    assert.match((await covers())[0].storage_path, /first\.png$/);
    await as('authenticated', other);
    assert.equal((await db.query('select * from public.project_preview_videos')).rows.length, 0);
    await assert.rejects(rpc('remove'), /permission denied/);
    await as('authenticated', owner);
    assert.equal((await db.query('select * from public.project_preview_videos')).rows.length, 1);
    await db.exec('update public.project_preview_videos set enabled=false');
    await as('anon');
    assert.equal((await resolve()).length, 0);
    console.log('Replayed 24 current-base migrations + video migration; platform Auth/Storage fixtures; pgcrypto install omitted in memory (core UUID generator); no hosted DB or concurrency claim.');
  } finally { await db.close(); }
});
