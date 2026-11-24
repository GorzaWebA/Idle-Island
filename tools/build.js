#!/usr/bin/env node
/*
 * Inlines the CSS and scripts into single files:
 *   dist/idle-island.html  standalone page (open it straight from disk, or host it anywhere)
 *   dist/artifact.html     the same content as a fragment without <html>/<head>/<body>,
 *                          for hosts that wrap the page themselves
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const js = scripts.map(src => '/* ' + src + ' */\n' + fs.readFileSync(path.join(root, src), 'utf8')).join('\n');
const body = html.split('<!--BODY-START-->')[1].split('<!--BODY-END-->')[0].trim();
const fonts = html.match(/<link rel="stylesheet" href="(https:\/\/fonts[^"]+)">/)[1];
const title = html.match(/<title>([^<]+)<\/title>/)[1];
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const head =
  '<title>' + title + '</title>\n' +
  '<link rel="stylesheet" href="' + fonts + '">\n' +
  '<style>\n' + css + '\n</style>\n';
const tail = '<script>\n' + safeJs + '\n</script>\n';

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), head + body + '\n' + tail);
fs.writeFileSync(path.join(root, 'dist', 'idle-island.html'),
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  head + '</head>\n<body>\n' + body + '\n' + tail + '</body>\n</html>\n');
console.log('Built dist/idle-island.html and dist/artifact.html (' + Math.round((head.length + body.length + tail.length) / 1024) + ' KB)');
