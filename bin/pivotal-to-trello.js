#!/usr/bin/env node
'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
var path = require('path');
var fs = require('fs');
var minimist = require('minimist');
const importer = require("./index");
var args = minimist(process.argv.slice(2));
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const opts = {};
        if (args.h || args.help) {
            var usage = path.join(__dirname, 'usage.txt');
            fs.createReadStream(usage).pipe(process.stdout);
            return;
        }
        if (!args.k && !args['trello-key']) {
            console.log('You must supply a Trello key with either --trello-key or -k');
            console.log('You can obtain a Trello key by clicking on this link: https://trello.com/1/appKey/generate');
            process.exit(1);
        }
        else {
            opts.trello_key = args.k || args['trello-key'];
        }
        if (!args.t && !args['trello-token']) {
            console.log('You must supploy a Trello token with either --trello-token or -t');
            console.log('You can request a new token by clicking this link: https://trello.com/1/connect?key=' + opts.trello_key + '&name=Pivotal%20Importer&response_type=token&expiration=never&scope=read,write');
            process.exit(1);
        }
        else {
            opts.trello_token = args.t || args['trello-token'];
        }
        if (!args.p && !args['pivotal-token']) {
            console.log('You must supply a Pivotal token either with -p or --pivotal-token');
            console.log('You can obtain your Pivotal token by clicking this link: https://www.pivotaltracker.com/profile');
            process.exit(1);
        }
        else {
            opts.pivotal = args.p || args['pivotal-token'];
        }
        if (!args.f && !args['from-board']) {
            console.log('You must specify a Pivotal Project ID from which to import');
            process.exit(1);
        }
        else {
            opts.from = args.f || args['from-board'];
        }
        if (!args.b && !args['to-board']) {
            console.log('You must specify a Trello board ID to which it will import');
            process.exit(1);
        }
        else {
            opts.to = args.b || args['to-board'];
        }
        yield importer.runImport(opts);
    });
}
(() => __awaiter(this, void 0, void 0, function* () {
    try {
        console.log('Starting main()');
        yield main();
        console.log('Finished main()');
    }
    catch (e) {
        console.error(e);
    }
}))();
//# sourceMappingURL=pivotal-to-trello.js.map