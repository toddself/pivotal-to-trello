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

const appName = 'pivotal-to-trello';

export interface IOptions {
  trello_key: string;
  trello_token: string;
  pivotal: string;
  from: string;
  to: string;
}

/** Incomplete list of Pivotal Tracker story properties - see https://www.pivotaltracker.com/help/api/rest/v5#story_resource */
interface IPivotalStory {
  id: number;
  project_id: number;
  name: string;
  description: string;
  story_type: "feature" | "bug" | "chore" | "release";
  current_state: "accepted" | "delivered" | "finished" | "started" | "rejected" | "planned" | "unstarted" | "unscheduled";
  estimate: number;
  accepted_at: Date;
  deadline: Date;
  projected_completion: Date;
  points_accepted: number;
  points_total: number;
  requested_by_id: number;
  tasks: IPivotalTaskProperty;
  notes: IPivotalNoteProperty;
}

interface IPivotalTaskProperty {
  task: IPivotalTask | IPivotalTask[];
}

interface IPivotalTask {
  id: number;
  story_id: number;
  description: string;
  complete: boolean;
  position: number;
  created_at: Date;
  updated_at: Date;
  kind: string;
}

interface IPivotalNoteProperty {
  note: IPivotalNote | IPivotalNote[];
}

interface IPivotalNote {
  id: number;
  story_id: number;
  epic_id: number;
  text: string;
  person_id: number;
  created_at: Date;
  updated_at: Date;
  file_attachment_ids: number[];
  google_attachment_ids: number[];
  commit_identifier: string;
  commit_type: string;
  kind: string;
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

interface ITrelloCard {
  id: string;
  badges: object;
  checkItemStates: object[];
  closed: boolean;
  dateLastActivity: Date;
  desc: string;
  descData: object;
  due: Date;
  dueComplete: boolean;
  email: string;
  idAttachmentCover: string;
  idBoard: string;
  idChecklists: string[];
  idLabels: string[];
  idList: string[];
  idMembers: string[];
  idMembersVoted: string[];
  idShort: number;
  labels: any[];
  name: string;
  pos: number;
  shorLink: string;
  shortUrl: string;
  subscribed: boolean;
  url: string;
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

/** Run the import from Pivotal Tracker to Trello using the specified options */
export async function runImport(opts: IOptions) {

  try {

    // Configure the Trello and Pivotal Tracker APIs
    console.log('Configuring API options');
    var trello = new Trello(opts.trello_key, opts.trello_token);
    pivotal.useToken(opts.pivotal);

    // Pull the stories down from Pivotal
    console.log('Retrieving stories from Pivotal Tracker')
    const pivotalStories = await readPivotalStories(opts);
    console.log(`Retrieved ${pivotalStories.length} stories from Pivotal Tracker.`);

    // Create the required Trello lists
    console.log('Getting Trello lists');
    let trelloLists = await getTrelloListsFromBoard(opts, trello);
    console.log(`Retrieved ${trelloLists.length} lists from Trello`);
    let trelloListDictionary = await verifyTrelloLists(opts, trello, trelloLists);

    // Copy the Pivotal stories over to the Trello cards
    console.log('Creating Trello cards');
    await createTrelloCards(opts, trello, trelloListDictionary, pivotalStories);

    console.log('Finished');
  }
  catch (err) {
    console.error(err);
  }
}

/** Read the full set of stories from the source Pivotal project */
function readPivotalStories(opts: IOptions) {
  var promise = new Promise<any[]>((resolve, reject) => {
    pivotal.getStories(opts.from, {}, function (err, stories) {
      if (err) {
        reject(err);
      } else {
        resolve(Array.isArray(stories.story) ? stories.story : [stories.story]);
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
    log.info(appName, 'The following lists will be created:', needed.join(', '));
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
async function createTrelloCards(opts: IOptions, trello, trelloListDictionary: ITrelloListDictionary, pivotalStories: IPivotalStory[]) {
  console.log(`Creating ${pivotalStories.length} cards in Trello`);
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

  console.log(`Creating Trello card for Pivotal story "${story.name}"`);

  var promise = new Promise<ITrelloCard>((resolve, reject) => {
    trello.post('/1/cards', trelloPayload, function (err, card) {
      log.info(appName, 'migrating', story.id, story.name);
      if (err) {
        reject(err);
      } else {
        resolve(card);
      }
    });
  });
  return promise;
}

async function attachCardData(opts: IOptions, trello, pivotalStory: IPivotalStory, trelloCard: ITrelloCard) {

  if (pivotalStory.tasks && pivotalStory.tasks.task) {
    const tasks = Array.isArray(pivotalStory.tasks.task) ? pivotalStory.tasks.task : [pivotalStory.tasks.task];
    await addChecklistsToTrelloCard(trello, trelloCard.id, tasks, pivotalStory.name);
  }

  if (pivotalStory.notes && pivotalStory.notes.note) {
    const notes = Array.isArray(pivotalStory.notes.note) ? pivotalStory.notes.note : [pivotalStory.notes.note];
    await addCommentsToTrelloCard(trello, trelloCard.id, notes, pivotalStory.name);
  }

  // if (pivotalStory.attachments && pivotalStory.attachments.attachment) {
  //   const attachments = Array.isArray(pivotalStory.attachments.attachment) ? pivotalStory.attachments.attachment : [pivotalStory.attachments.attachment];
  //   await addAttachmentsToTrelloCard(opts, trello, pivotal, trelloCard.id, attachments, pivotalStory.name);
  // }
}

/** Add any checklist items to the Trello card */
async function addChecklistsToTrelloCard(trello, cardId: string, tasks: IPivotalTask[], storyName: string) {

  // we have to create a checklist itself before we can add items to it...
  const checklist = await createTrelloChecklist(trello, cardId);

  console.log(`Adding ${tasks.length} checklists to card ${cardId}`);
  for (let checkItem of tasks) {
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
function addTrelloChecklistItem(trello, checklist, task: IPivotalTask, storyName: string) {
  if (VERBOSE) {
    log.info(appName, 'adding checkItem: %s for %s', task.description, storyName);
  }
  var checkItemPayload = {
    name: task.description,
    pos: task.position,
    idChecklist: checklist.id,
    checked: task.complete
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
async function addCommentsToTrelloCard(trello, cardId: string, notes: IPivotalNote[], storyName: string) {
  console.log(`Adding ${notes.length} comments to card ${cardId}`);
  for (let note of notes) {
    await addCommentToTrelloCard(trello, cardId, note, storyName);
  }
}

/** Add a specific comment to the target Trello card. */
function addCommentToTrelloCard(trello, cardId: string, note: IPivotalNote, storyName: string) {
  if (VERBOSE) {
    log.info(appName, 'adding comment: %s for %s', note.text, storyName);
  }
  var commentPayload = {
    text: note.text
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
  console.log(`Adding ${attachments.length} attachments to trello card ${cardId}`);
  var attachmentsURI = trelloAPI + '/1/cards/' + cardId + '/attachments?key=' + opts.trello_key + '&token=' + opts.trello_token;
  for (const attachment of attachments) {
    await addAttachmentToTrelloCard(attachment, attachmentsURI, storyName);
  }
}

/** Add an attachment from Pivotal Tracker to the corresponding Trello card. */
function addAttachmentToTrelloCard(attachment, attachmentsURI: string, storyName: string) {
  log.info(appName, 'adding attachment: %s for %s', attachment.filename, storyName);

  const promise = new Promise((resolve, reject) => {
    var tmpFile = tmp.fileSync();
    var fileName = tmpFile.name;
    var s = fs.createWriteStream(fileName);

    s.on('error', function (err) {
      log.error(appName, err);
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
          log.error(appName, 'Could not create attachment', err);
          log.error(appName, attachment);
          reject(err);
        });

        req.on('response', function (res: any) {
          if (res.statusCode !== 200) {
            log.error(appName, 'Could not create attachment', res.statusCode);
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