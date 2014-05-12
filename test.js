'use strict';

var fs = require('fs');
var request = require('request');
var auth = require('./auth');
var FormData = require('form-data');
var mime = require('mime');

var r = request({
  url: 'https://api.trello.com/1/cards/537127b3343e2cc46f252ce3/attachments?key='+auth.trello.key+'&token='+auth.trello.token,
  proxy: '',
}, function(err, resp, body){
  console.log('err', err);
  console.log('resp', resp.statusCode);
  console.log('body', body);
});

var form = new FormData();
form.append('file', fs.readFileSync('readme.md', 'utf-8'), {contentType: mime.lookup('readme.md')});
form.append('name', 'readme.md');

form.pipe(r);