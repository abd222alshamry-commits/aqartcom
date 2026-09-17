'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
// Only frontend files at the project root are public. Never serve the repository.
module.exports = function publicFiles(root) {
  const allowed = new Set(fs.readdirSync(root).filter(name =>
    /\.(html|css|js|webmanifest)$/.test(name) && !name.startsWith('scripts_')));
  const serve = express.static(root, { dotfiles: 'deny', index: false, redirect: false });
  return (req, res, next) => {
    let pathname;
    try { pathname = decodeURIComponent(req.path); } catch { return res.sendStatus(400); }
    if (pathname === '/') { res.setHeader('Cache-Control', 'no-store'); return res.sendFile(path.join(root, 'index.html')); }
    const file = pathname.slice(1);
    if (/^sol-runtime\/3\.8\.1\/(transformers\.min\.mjs|ort-wasm-simd-threaded\.jsep\.(mjs|wasm)|LICENSE-(transformers|onnxruntime)\.txt)$/.test(file)) {
      res.setHeader('Cache-Control','public, max-age=31536000, immutable');
      return serve(req,res,next);
    }
    if (allowed.has(file) || /^icons\/[a-zA-Z0-9_-]+\.(png|svg|ico)$/.test(file) || /^assets\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/.test(file)) {
      if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
      if (file === 'service-worker.js') res.setHeader('Cache-Control', 'no-cache');
      return serve(req, res, next);
    }
    next();
  };
};
