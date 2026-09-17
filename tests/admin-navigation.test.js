'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('admin tab renders async API errors rather than leaving an inert panel',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../admin.js'),'utf8');
 const render=source.slice(source.indexOf('async function render(){'),source.indexOf('async function overview('));
 const content={innerHTML:''};const context=vm.createContext({tab:'overview',document:{querySelectorAll:()=>[],getElementById:()=>content},esc:s=>s.replaceAll('<','&lt;'),overview:async()=>{throw Error('permission <denied>')}});
 vm.runInContext(render,context);await vm.runInContext('render()',context);
 assert.match(content.innerHTML,/permission &lt;denied>/);
});
