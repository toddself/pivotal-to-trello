#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const minimist = require('minimist');

import * as importer from './index';

const args = minimist(process.argv.slice(2));

async function main() {

  const opts: importer.IOptions = <any>{};

  if (args.h || args.help) {
    const usage = path.join(__dirname, 'usage.txt');
    fs.createReadStream(usage).pipe(process.stdout);
    return;
  }

  if (!args.k && !args['trello-key']) {
    console.log('You must supply a Trello key with either --trello-key or -k');
    console.log('You can obtain a Trello key by clicking on this link: https://trello.com/1/appKey/generate');
    process.exit(1);
  } else {
    opts.trello_key = args.k || args['trello-key'];
  }

  if (!args.t && !args['trello-token']) {
    console.log('You must supploy a Trello token with either --trello-token or -t');
    console.log('You can request a new token by clicking this link: https://trello.com/1/connect?key=' + opts.trello_key + '&name=Pivotal%20Importer&response_type=token&expiration=never&scope=read,write');
    process.exit(1);
  } else {
    opts.trello_token = args.t || args['trello-token'];
  }

  if (!args.p && !args['pivotal-token']) {
    console.log('You must supply a Pivotal token either with -p or --pivotal-token');
    console.log('You can obtain your Pivotal token by clicking this link: https://www.pivotaltracker.com/profile');
    process.exit(1);
  } else {
    opts.pivotal = args.p || args['pivotal-token'];
  }

  if (!args.f && !args['from-board']) {
    console.log('You must specify a Pivotal Project ID from which to import');
    process.exit(1);
  } else {
    opts.from = args.f || args['from-board'];
  }

  if (!args.b && !args['to-board']) {
    console.log('You must specify a Trello board ID to which it will import');
    process.exit(1);
  } else {
    opts.to = args.b || args['to-board'];
  }

  await importer.runImport(opts);
}

(async () => {
  try {
      console.log('Starting main()')
      await main();
      console.log('Finished main()')
  } catch (e) {
      console.error(e);      
  }
})();