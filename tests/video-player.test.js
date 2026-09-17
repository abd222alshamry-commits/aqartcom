'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolveVideo, preview} = require('../video-player');
const vm = require('node:vm');
const fs = require('node:fs');

test('uploaded and signed media links retain their path and query', () => {
  const local = resolveVideo('/uploads/home.mp4?signature=abc#t=12');
  assert.equal(local.type, 'file');
  assert.equal(local.url, 'https://aqartcom-v93.onrender.com/uploads/home.mp4?signature=abc#t=12');
  assert.equal(resolveVideo('https://media.example/home.MOV?token=xyz').type, 'file');
});
test('YouTube watch, short, and embed URLs use the same safe video identifier', () => {
  for (const url of ['https://youtu.be/dQw4w9WgXcQ?t=10', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=1', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ']) {
    const video = resolveVideo(url);
    assert.equal(video.type, 'youtube');
    assert.equal(new URL(video.embed).hostname, 'www.youtube-nocookie.com');
    assert.equal(new URL(video.embed).searchParams.get('autoplay'), '0');
  }
});
test('Facebook embeds preserve video identity and wait for a play gesture to avoid autoplay muting', () => {
  for (const url of ['https://www.facebook.com/100079461761425/videos/27922983067403817/?__cft__[0]=tracking', 'https://m.facebook.com/reel/27922983067403817/', 'https://facebook.com/watch/?v=27922983067403817&tracking=1']) {
    const video = resolveVideo(url), embed = new URL(video.embed);
    assert.equal(video.type, 'facebook');
    assert.equal(embed.hostname, 'www.facebook.com');
    assert.match(embed.searchParams.get('href'), /27922983067403817/);
    assert.doesNotMatch(embed.searchParams.get('href'), /tracking|__cft__/);
    assert.equal(embed.searchParams.get('mute'), 'false');
    assert.equal(embed.searchParams.get('autoplay'), 'false');
  }
});
test('untrusted schemes and credentials cannot enter the player', () => {
  for (const url of ['', 'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test.mp4', 'https://youtube.com@evil.test/video.mp4']) assert.equal(resolveVideo(url), null);
  for (const url of ['https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://evil.test/?next=youtu.be/dQw4w9WgXcQ', 'https://facebook.com.evil.test/watch/?v=123']) assert.equal(resolveVideo(url).type, 'external');
  assert.equal(resolveVideo('https://youtube.com/watch?v=<script>').type, 'external');
});
test('preview markup escapes advertiser-supplied titles and URLs', () => {
  const html = preview({url:'/uploads/home.mp4', title:'<img src=x onerror="alert(1)">'}, '/assets/property-building.webp');
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /data-property-video="\{&quot;/);
  assert.match(html, /type="button"/);
});
test('TikTok post links stay inside an embed that waits for the second tap', () => {
  const result=resolveVideo('https://www.tiktok.com/@office/video/6718335390845095173');
  assert.equal(result.type,'tiktok');
  const url=new URL(result.embed);
  assert.equal(url.pathname,'/player/v1/6718335390845095173');
  assert.equal(url.searchParams.get('autoplay'),'0');
  assert.equal(url.searchParams.get('muted'),'0');
  assert.equal(resolveVideo('https://tiktok.com.evil.test/@office/video/123').type,'external');
});

test('legacy external video previews are intercepted instead of navigating off-site', () => {
  let click,prevented=false,stopped=false,viewerRequested=false;
  const sourceLink={dataset:{videoExternal:'true',videoTitle:'فيديو'},href:'https://external.example/video',hasAttribute(){return false;},getAttribute(){return 'فيديو';}};
  const document={
    addEventListener(name,handler){if(name==='click')click=handler;},
    createElement(){viewerRequested=true;throw Error('viewer-requested');}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../video-player'),'utf8'),{window:{},document,URL,location:{href:'https://aqartcom-v93.onrender.com/'}});
  assert.throws(()=>click({target:{closest(){return sourceLink;}},preventDefault(){prevented=true;},stopPropagation(){stopped=true;}}),/viewer-requested/);
  assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(viewerRequested,true);
});

function viewerHarness() {
  function events(object={}) {
    const listeners=new Map();
    return Object.assign(object,{
      addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
      emit(type,event={}){for(const fn of [...(listeners.get(type)||[])])fn(event);}
    });
  }
  function element(tag='div') {
    const node=events({tagName:tag.toUpperCase(),attributes:{},children:[],style:{},inert:false,isConnected:true,clientWidth:390,clientHeight:600,
      setAttribute(k,v){this.attributes[k]=v;},focus(){document.activeElement=this;},
      append(...children){for(const child of children){this.children.push(child);child.parent=this;}},
      remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);},
      contains(child){return child===this||this.children.some(x=>x.contains(child));}
    });
    node.classList={values:new Set(),add(v){this.values.add(v);},remove(v){this.values.delete(v);}};
    Object.defineProperty(node,'innerHTML',{get(){return this.html||'';},set(html){this.html=html;if(html.includes('video-viewer-header')){
      this.parts={};for(const name of ['stage','tools','close','return']){const child=element(name==='close'||name==='return'?'button':'div');this.parts['.video-viewer-'+name]=child;this.append(child);}
    }}});
    node.querySelector=selector=>node.parts?.[selector]||null;
    node.querySelectorAll=()=>[];
    return node;
  }
  const document=events({createElement:element,fullscreenElement:null});
  document.body=element('body');const page=element('main'),alreadyInert=element('aside');alreadyInert.inert=true;document.body.append(page,alreadyInert);
  const focus=element('button');document.activeElement=focus;
  const window=events();let backCalls=0;const stack=[{page:'listing'}];
  const history={get state(){return stack.at(-1);},pushState(state){stack.push(state);},back(){backCalls++;if(stack.length>1)stack.pop();window.emit('popstate');}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../video-player'),'utf8'),{window,document,history,location:{href:'https://aqartcom-v93.onrender.com/office-property.html?id=18'},URL});
  return {api:window.PropertyVideo,document,window,history,page,alreadyInert,focus,backCalls:()=>backCalls,viewer:()=>document.body.children.find(e=>e.className==='property-video-viewer')};
}

test('closing embedded playback stops its frame, restores the page and consumes only the viewer history entry',()=>{
  const h=viewerHarness();h.api.open({url:'https://facebook.com/reel/123456789/',title:'عقار'});
  const viewer=h.viewer(),frame=viewer.querySelector('.video-viewer-stage').children[0];
  assert.equal(h.page.inert,true);assert.ok(h.history.state.propertyVideo);
  assert.equal(frame.tagName,'IFRAME');assert.match(frame.src,/autoplay=false/);
  const sandbox=frame.attributes.sandbox.split(' ');
  assert.ok(sandbox.includes('allow-scripts'));assert.ok(!sandbox.some(x=>x.includes('navigation')||x.includes('popups')));
  assert.doesNotMatch(viewer.innerHTML,/href=|target=/);
  h.api.open({url:'https://youtu.be/dQw4w9WgXcQ'});assert.equal(h.viewer(),viewer);
  viewer.querySelector('.video-viewer-close').onclick();
  assert.equal(frame.src,'about:blank');assert.equal(h.viewer(),undefined);
  assert.equal(h.page.inert,false);assert.equal(h.alreadyInert.inert,true);
  assert.equal(h.document.activeElement,h.focus);assert.equal(h.backCalls(),1);
  assert.equal(h.history.state.page,'listing');
});

test('browser Back closes the viewer without a second history navigation; unsupported links remain closable inside the site',()=>{
  const h=viewerHarness();h.api.open({url:'https://example.com/video'});
  const viewer=h.viewer();assert.match(viewer.querySelector('.video-viewer-stage').innerHTML,/غير مدعوم/);
  h.history.back();assert.equal(h.viewer(),undefined);assert.equal(h.backCalls(),1);assert.equal(h.history.state.page,'listing');
  h.api.open({url:'https://example.com/video'});h.viewer().querySelector('.video-viewer-return').onclick();
  assert.equal(h.viewer(),undefined);assert.equal(h.backCalls(),2);
});

test('entering a provider fullscreen frame keeps the viewer open; exiting fullscreen closes it once',()=>{
  const h=viewerHarness();h.api.open({url:'https://youtu.be/dQw4w9WgXcQ'});
  const viewer=h.viewer(),frame=viewer.querySelector('.video-viewer-stage').children[0];
  h.document.fullscreenElement=viewer;h.document.emit('fullscreenchange');
  h.document.fullscreenElement=frame;h.document.emit('fullscreenchange');assert.equal(h.viewer(),viewer);
  h.document.fullscreenElement=null;h.document.emit('fullscreenchange');
  assert.equal(h.viewer(),undefined);assert.equal(h.backCalls(),1);assert.equal(frame.src,'about:blank');
});
