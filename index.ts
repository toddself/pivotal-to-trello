'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as log from 'npmlog'
import * as pivotal from 'pivotal';
import * as request from 'hyperquest';
import * as async from 'async';
import * as FormData from 'form-data';
import * as Trello from 'node-trello';
import * as tmp from 'tmp';
import * as sleep from 'sleep-promise';

export interface IOptions {
  trello_key: string;
  trello_token: string;
  pivotal: string;
  from: string;
  to: string;
}

interface ITrelloBoard {
  id: string;
  name: string;
  desc: string;
  descData: string;
  closed: boolean;
  idOrganization: string;
  pinned: boolean;
  url: string;
  shortUrl: string;
  prefs: object;
  labelNames: object;
  starred: boolean;
  limits: object;
  memberships: any[];
}

interface ITrelloList {
  id: string;
  name: string;
  closed: boolean;
  idBoard: string;
  pos: number;
  subscribed: boolean;
}

interface ITrelloListDictionary {
  [name: string]: ITrelloList;
}

const PROXY = process.env.PROXY || '';
const VERBOSE = process.env.VERBOSE || false;
const trelloAPI = process.env.TRELLO_API || 'https://api.trello.com';
const requiredLists = ['accepted', 'delivered', 'rejected', 'finished', 'current', 'backlog', 'icebox'];

const maxParallelization = 1;
const delayInMs = 100;

if (PROXY) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

/** Read the full set of stories from the source Pivotal project */
function readPivotalStories(opts: IOptions) {
  var promise = new Promise<any[]>((resolve, reject) => {
    pivotal.getStories(opts.from, {}, function (err, stories) {
      if (err) {
        reject(err);
      } else {
        resolve(stories);
      }
    });
  });
  return promise;
}

/** Make sure that the required lists are present on the target trello board. */
async function verifyTrelloLists(opts: IOptions, trello, startingLists: ITrelloList[]) {

  var lists = organizeLists(startingLists);

  // Figure out which lists we need to create
  var needed = requiredLists.slice(0);
  for (var list of startingLists) {
    var idx = needed.indexOf(list.name.toLowerCase());
    if (idx > -1) {
      needed.splice(idx, 1);
    }
  }

  if (needed.length > 0) {
    log.info('pivotal-to-trello', 'The following lists will be created:', needed.join(', '));
    for (const listName of needed) {
      const list = await makeTrelloList(trello, opts, listName);
      lists[list.name] = list;
    }
  }

  return lists;
}

/** Transform the lists into a dictionary object */
function organizeLists(trelloLists: ITrelloList[]): ITrelloListDictionary {
  var dictionary = trelloLists.reduce(function (a, list) {
    a[list.name.toLowerCase()] = list;
    return a;
  }, {});
  return dictionary;
}

/** Makes and returns a Trello list */
function makeTrelloList(trello, opts: IOptions, listName) {
  var boardUrl = '/1/boards/' + opts.to + '/lists';
  var listPayload = {
    name: listName
  };
  var promise = new Promise<any>((resolve, reject) => {
    trello.post(boardUrl, listPayload, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
  return promise;
}

/** Retrieve the existing set of lists on the Trello board */
function getTrelloListsFromBoard(opts: IOptions, trello) {
  return new Promise<any[]>((resolve, reject) => {
    trello.get('/1/boards/' + opts.to + '/lists', function (err, lists: [any]) {
      if (err) {
        reject(err);
      }
      else {
        resolve(lists);
      }
    });
  });
}

/** Create the Trello cards */
async function createTrelloCards(opts: IOptions, trello, trelloListDictionary: ITrelloListDictionary, pivotalStories: any[]) {
  for (let i = 0; i < pivotalStories.length; i++) {
    const pivotalStory = pivotalStories[i];
    const trelloCard = await createTrelloCard(trello, opts.trello_key, opts.trello_token, trelloListDictionary, pivotalStory, i)
    await attachCardData(opts, trello, pivotalStory, trelloCard);
  }
}

/** Create the Trello card, and bring over any associated items */
function createTrelloCard(trello, key, token, trelloListDictionary: ITrelloListDictionary, story, storyIndex: number) {
  var destList = story.current_state.toLowerCase();

  if (destList === 'unscheduled') {
    destList = 'icebox';
  } else if (destList === 'unstarted') {
    destList = 'backlog';
  } else if (destList === 'planned') {
    destList = 'backlog';
  } else if (destList === 'started') {
    destList = 'current';
  }

  var trelloList = trelloListDictionary[destList];
  if (!trelloList) {
    log.error('No list matching "' + destList + '" was found for pivotal story "' + story.name + '".');
    return;
  }
  var trelloListId = trelloList.id;
  var labels = [story.story_type];
  if (story.labels) {
    labels = labels.concat(story.labels);
  }
  var trelloPayload = {
    name: story.name,
    desc: story.description || '',
    labels: labels,
    pos: storyIndex,
    idList: trelloList.id
  };

  var promise = new Promise<any>((resolve, reject) => {
    trello.post('/1/cards', trelloPayload, function (err, card) {
      log.info('pivotal-to-trello', 'migrating', story.id, story.name);
      if (err) {
        reject(err);
      } else {
        resolve(card);
      }
    });
  });
}

async function attachCardData(opts: IOptions, trello, pivotalStory, trelloCard) {

  if (pivotalStory.tasks && pivotalStory.tasks.task) {
    const tasks = Array.isArray(pivotalStory.tasks.task) ? pivotalStory.tasks.task : [pivotalStory.tasks.task];
    await addChecklistsToTrelloCard(trello, trelloCard.id, tasks, pivotalStory.name);
  }

  if (pivotalStory.notes && pivotalStory.notes.note) {
    const notes = Array.isArray(pivotalStory.notes.note) ? pivotalStory.notes.note : [pivotalStory.notes.note];
    await addCommentsToTrelloCard(trello, trelloCard.id, notes, pivotalStory.name);
  }

  if (pivotalStory.attachments && pivotalStory.attachments.attachment) {
    const attachments = Array.isArray(pivotalStory.attachments.attachment) ? pivotalStory.attachments.attachment : [pivotalStory.attachments.attachment];
    await addAttachmentsToTrelloCard(opts, trello, pivotal, trelloCard.id, attachments, pivotalStory.name);
  }
}

/** Add any checklist items to the Trello card */
async function addChecklistsToTrelloCard(trello, cardId: string, items: any[], storyName: string) {

  // we have to create a checklist itself before we can add items to it...
  const checklist = await createTrelloChecklist(trello, cardId);

  for (let checkItem of items) {
    await addTrelloChecklistItem(trello, checklist, checkItem, storyName);
  }
}

/** Create a checklist in the Trello card */
function createTrelloChecklist(trello, cardId) {
  var promise = new Promise<any>((resolve, reject) => {
    trello.post('/1/cards/' + cardId + '/checklists', function (err, checklist) {
      if (err) {
        reject(err);
      } else {
        resolve(checklist);
      }
    });
  });
  return promise;
}

/** Add an item to the Trello card's checklist */
function addTrelloChecklistItem(trello, checklist, checklistItem, storyName: string) {
  if (VERBOSE) {
    log.info('pivotal-to-trello', 'adding checkItem: %s for %s', checklistItem.description, storyName);
  }
  var checkItemPayload = {
    name: checklistItem.description,
    pos: checklistItem.position,
    idChecklist: checklist.id,
    checked: checklistItem.complete
  };

  const checkItemURI = '/1/checklists/' + checklist.id + '/checkItems';

  const promise = new Promise((resolve, reject) => {
    trello.post(checkItemURI, checkItemPayload, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
  return promise;
}

/** Add discussion history from a Pivotal story to the target Trello card. */
async function addCommentsToTrelloCard(trello, cardId: string, comments: any[], storyName: string) {
  for (let comment of comments) {
    await addCommentToTrelloCard(trello, cardId, comment, storyName);
  }
}

/** Add a specific comment to the target Trello card. */
function addCommentToTrelloCard(trello, cardId: string, comment, storyName: string) {
  if (VERBOSE) {
    log.info('pivotal-to-trello', 'adding comment: %s for %s', comment.text, storyName);
  }
  var commentPayload = {
    text: comment.text
  };
  var promise = new Promise((resolve, reject) => {
    trello.post('/1/cards/' + cardId + '/actions/comments', commentPayload, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
  return promise;
}

async function addAttachmentsToTrelloCard(opts: IOptions, trello, pivotal, cardId: string, attachments: any[], storyName: string) {
  var attachmentsURI = trelloAPI + '/1/cards/' + cardId + '/attachments?key=' + opts.trello_key + '&token=' + opts.trello_token;
  for (const attachment of attachments) {
    await addAttachmentToTrelloCard(attachment, attachmentsURI, storyName);
  }
}

/** Add an attachment from Pivotal Tracker to the corresponding Trello card. */
function addAttachmentToTrelloCard(attachment, attachmentsURI: string, storyName: string) {
  log.info('pivotal-to-trello', 'adding attachment: %s for %s', attachment.filename, storyName);

  const promise = new Promise((resolve, reject) => {

    var tmpFile = tmp.fileSync();
    var fileName = tmpFile.name;
    var s = fs.createWriteStream(fileName);

    s.on('error', function (err) {
      log.error('pivotal-to-trello', err);
    });

    s.on('close', function () {
      fs.readFile(fileName, function (err, data) {
        if (err) {
          return reject(err);
        }

        // the trello API is VERY pedantic about what it recieves and for
        // some reason request wasn't doing it right, so we'll build
        // the request using form-data and hyperquest ourselves
        var form = new FormData({});
        form.append('name', attachment.filename);
        form.append('file', data, { filename: fileName });
        var headers = form.getHeaders();
        headers['content-length'] = form.getLengthSync();

        var req = request(attachmentsURI, {
          method: 'POST',
          headers: headers
        });

        req.on('error', function (err: any) {
          log.error('pivotal-to-trello', 'Could not create attachment', err);
          log.error('pivotal-to-trello', attachment);
          reject(err);
        });

        req.on('response', function (res: any) {
          if (res.statusCode !== 200) {
            log.error('pivotal-to-trello', 'Could not create attachment', res.statusCode);
            res.pipe(process.stderr);
            reject(res.statusCode);
          } else {
            resolve();
          }
        });

        (form as any).pipe(req);
      });
    });

    var pivotalRequest = request(attachment.url, {
      headers: {
        'X-TrackerToken': pivotal
      }
    });

    pivotalRequest.on('response', function (res) {
      res.pipe(s);
    });
  });
}

export async function runImport(opts: IOptions) {
  var trello = new Trello(opts.trello_key, opts.trello_token);
  pivotal.useToken(opts.pivotal);

  try {
    // Pull the stories down from Pivotal
    const pivotalStories = await readPivotalStories(opts);

    // Create the required Trello lists
    let trelloLists = await getTrelloListsFromBoard(opts, trello);
    let trelloListDictionary = await verifyTrelloLists(opts, trello, trelloLists);

    // Copy the Pivotal stories over to the Trello cards
    await createTrelloCards(opts, trello, trelloListDictionary, pivotalStories);

    log.info('pivotal-to-trello', 'Finished');
  }
  catch (err) {
    log.error('pivotal-to-trello', err);
  }
}