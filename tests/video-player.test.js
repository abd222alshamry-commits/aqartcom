'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolveVideo, preview} = require('../video-player');

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
    assert.equal(new URL(video.embed).searchParams.get('autoplay'), '1');
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
