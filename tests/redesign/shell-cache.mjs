import assert from 'node:assert/strict';
import {readlink,lstat,unlink,symlink,mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=process.argv[2],link=resolve('.next');
const oldTarget=resolve(output,'../phase-1/test-runtime/current/.next'),newTarget=resolve(output,'test-runtime/.next');
assert.ok((await lstat(link)).isSymbolicLink(),'Only the harness-created .next junction may be switched');
const target=resolve(await readlink(link));assert.ok([oldTarget,newTarget,resolve(output,'../phase-2/test-runtime/.next'),resolve(output,'../phase-3/test-runtime/.next')].includes(target),'Unexpected .next target; preserve user cache');
await mkdir(resolve(newTarget,'static/chunks'),{recursive:true});await copyFile(resolve(output,'assets/app.css'),resolve(newTarget,'static/chunks/fixture.css'));
if(target!==newTarget){await unlink(link);await symlink(newTarget,link,'junction');}
await copyFile(resolve(output,'../phase-1/assets/app.css'),resolve(oldTarget,'static/chunks/fixture.css'));
console.log('Phase2 ignored test cache points outside repo; Phase1 cache restored to accepted CSS.');
