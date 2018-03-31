'use strict';

import * as path from 'path';
import * as fs from 'fs';
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

interface ITrelloListDictionary {
  [name: string]: ITrelloList;
}

interface ITaskError {
  task: string,
  item: string,
  errorMessage: string
}

const PROXY = process.env.PROXY || '';
const VERBOSE = process.env.VERBOSE || false;
const trelloAPI = process.env.TRELLO_API || 'https://api.trello.com';
const requiredLists = ['accepted', 'delivered', 'rejected', 'finished', 'current', 'backlog', 'icebox'];

if (PROXY) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const taskErrors: ITaskError[] = [];
const maxTaskErrors = 25;

/** Run the import from Pivotal Tracker to Trello using the specified options */
export async function runImport(opts: IOptions) {

  try {

    // Configure the Trello and Pivotal Tracker APIs
    console.log('Configuring API options');
    const trello = new Trello(opts.trello_key, opts.trello_token);
    pivotal.useToken(opts.pivotal);

    // Pull the stories down from Pivotal
    const pivotalStories = await readPivotalStories(opts);
    console.log(`Retrieved ${pivotalStories.length} stories from Pivotal Tracker.`);

    // Create the required Trello lists
    const trelloLists = await getTrelloListsFromBoard(opts, trello);
    const trelloListDictionary = await verifyTrelloLists(opts, trello, trelloLists);
    console.log(`Retrieved ${trelloLists.length} lists from Trello`);

    // Copy the Pivotal stories over to the Trello cards
    console.log('Creating Trello cards');
    await createTrelloCards(opts, trello, trelloListDictionary, pivotalStories);

    if (taskErrors.length) {
      console.error(`*** Processing encountered ${taskErrors.length} errors ***`)
      for (const taskError of taskErrors) {
        console.error(`Task: "${taskError.task}", Item:"${taskError.item}", Error: "${taskError.errorMessage}"`);
      }
    }

    console.log('Finished');
  }
  catch (err) {
    try {
      console.error(JSON.stringify(err));
    } catch {
      console.error(getErrorMessage(err));
    }
  }
}

/** Read the full set of stories from the source Pivotal project */
function readPivotalStories(opts: IOptions) {
  const promise = new Promise<any[]>((resolve, reject) => {
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

  const lists = organizeLists(startingLists);

  // Figure out which lists we need to create
  const needed = requiredLists.slice(0);
  for (const list of startingLists) {
    const idx = needed.indexOf(list.name.toLowerCase());
    if (idx > -1) {
      needed.splice(idx, 1);
    }
  }

  if (needed.length > 0) {
    console.log(`The following lists will be created: ${needed.join(', ')}`);
    for (const listName of needed) {
      const list = await makeTrelloList(opts, trello, listName);
      lists[list.name] = list;
    }
  }

  return lists;
}

/** Transform the lists into a dictionary object */
function organizeLists(trelloLists: ITrelloList[]): ITrelloListDictionary {
  const dictionary = trelloLists.reduce(function (a, list) {
    a[list.name.toLowerCase()] = list;
    return a;
  }, {});
  return dictionary;
}

/** Makes and returns a Trello list */
function makeTrelloList(opts: IOptions, trello, listName: string) {
  const boardUrl = '/1/boards/' + opts.to + '/lists';
  const listPayload = {
    name: listName
  };
  const promise = new Promise<ITrelloList>((resolve, reject) => {
    trello.post(boardUrl, listPayload, (err, list) => {
      if (err) {
        reject(err);
      } else {
        resolve(list);
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
    try {
      const trelloCard = await retry(() => createTrelloCard(trello, trelloListDictionary, pivotalStory, i));
      await attachCardData(opts, trello, pivotalStory, trelloCard);
    }
    catch (err) {
      handleTaskError('create card', pivotalStory.name, err);
    }
  }
}

/** Create the Trello card, and bring over any associated items */
function createTrelloCard(trello, trelloListDictionary: ITrelloListDictionary, story: IPivotalStory, storyIndex: number) {
  let destList = story.current_state.toLowerCase();

  if (destList === 'unscheduled') {
    destList = 'icebox';
  } else if (destList === 'unstarted') {
    destList = 'backlog';
  } else if (destList === 'planned') {
    destList = 'backlog';
  } else if (destList === 'started') {
    destList = 'current';
  }

  const trelloList = trelloListDictionary[destList];
  if (!trelloList) {
    console.error(`No list matching ${destList} was found for pivotal story ${story.name}`);
    return;
  }
  const trelloListId = trelloList.id;
  let labels = [<string>story.story_type];
  if (story.labels) {
    labels = labels.concat(story.labels);
  }
  const trelloPayload = {
    name: story.name,
    desc: story.description || '',
    labels: labels,
    pos: storyIndex,
    idList: trelloList.id
  };

  console.log(`Creating Trello card for Pivotal story "${story.name}"`);

  const promise = new Promise<ITrelloCard>((resolve, reject) => {
    trello.post('/1/cards', trelloPayload, function (err, card) {
      console.log(`migrating story id ${story.id}`);
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
  for (const checkItem of tasks) {
    try {
      await retry(() => addTrelloChecklistItem(trello, checklist, checkItem, storyName));
    } catch (err) {
      handleTaskError('add checklist item', checkItem.description, err);
    }
  }
}

/** Create a checklist in the Trello card */
function createTrelloChecklist(trello, cardId) {
  const promise = new Promise<any>((resolve, reject) => {
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
    console.log(`adding checkItem: ${task.description} for ${storyName}`);
  }
  const checkItemPayload = {
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
  for (const note of notes) {
    try {
      await retry(() => addCommentToTrelloCard(trello, cardId, note, storyName));
    } catch (err) {
      handleTaskError('add comment', note.text, err);
    }
  }
}

/** Add a specific comment to the target Trello card. */
function addCommentToTrelloCard(trello, cardId: string, note: IPivotalNote, storyName: string) {
  if (VERBOSE) {
    console.log(`adding comment: ${note.text} for ${storyName}`);
  }
  const commentPayload = {
    text: note.text
  };
  const promise = new Promise((resolve, reject) => {
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
  const attachmentsURI = trelloAPI + '/1/cards/' + cardId + '/attachments?key=' + opts.trello_key + '&token=' + opts.trello_token;
  for (const attachment of attachments) {
    try {
      await retry(() => addAttachmentToTrelloCard(attachment, attachmentsURI, storyName));
    } catch (err) {
      handleTaskError('add attachment', attachment.fileName, err);
    }
  }
}

/** Add an attachment from Pivotal Tracker to the corresponding Trello card. */
function addAttachmentToTrelloCard(attachment, attachmentsURI: string, storyName: string) {
  console.log(`adding attachment "${attachment.fileName}" for "${storyName}"`);

  const promise = new Promise((resolve, reject) => {
    const tmpFile = tmp.fileSync();
    const fileName = tmpFile.name;
    const s = fs.createWriteStream(fileName);

    s.on('error', function (err) {
      console.error(getErrorMessage(err));
    });

    s.on('close', function () {
      fs.readFile(fileName, function (err, data) {
        if (err) {
          return reject(err);
        }

        // the trello API is VERY pedantic about what it recieves and for
        // some reason request wasn't doing it right, so we'll build
        // the request using form-data and hyperquest ourselves
        const form = new FormData({});
        form.append('name', attachment.fileName);
        form.append('file', data, { filename: fileName });
        const headers = form.getHeaders();
        headers['content-length'] = form.getLengthSync();

        const req = request(attachmentsURI, {
          method: 'POST',
          headers: headers
        });

        req.on('error', function (err: any) {
          console.error(`Could not create attachment ${attachment.fileName}: ${getErrorMessage(err)}`);
          reject(err);
        });

        req.on('response', function (res: any) {
          if (res.statusCode !== 200) {
            console.error(`Could not create attachment ${attachment.fileName}: ${getErrorMessage(err)}`)
            res.pipe(process.stderr);
            reject(res.statusCode);
          } else {
            resolve();
          }
        });

        (form as any).pipe(req);
      });
    });

    const pivotalRequest = request(attachment.url, {
      headers: {
        'X-TrackerToken': pivotal
      }
    });

    pivotalRequest.on('response', function (res) {
      res.pipe(s);
    });
  });
  return promise;
}

async function retry<T>(action: () => Promise<T>, retryCount: number = 5, delayInMs: number = 500) {
  let i = 0;
  while (i < retryCount) {
    try {
      return await action();
    } catch (err) {
      if (++i < retryCount) {
        if (err.statusCode === 429) {
          console.warn(`Encountered a rate limit error; delaying next call for four seconds.`);
          await sleep(4000);
        } else {
          console.warn(`Encountered an error in retry block ${i}: "${getErrorMessage(err)}"`);
          await sleep(delayInMs * i);
        }
      } else {
        console.error(`Encountered a fatal error in retry block ${i} (bailing): "${getErrorMessage(err)}"`);
        throw err;
      }
    }
  }
}

function getErrorMessage(err: any) {
  if (typeof err == "string") {
    return err;
  }
  if (err.statusMessage) {
    return err.statusMessage;
  }
  if (err.message) {
    return err.message;
  }
  if (err.text) {
    return err.text;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return err;
  }
}

/** When an error occurs performing a specific task */
function handleTaskError(task: string, item: string, err: any) {
  const taskError: ITaskError = {
    task: task,
    item: item,
    errorMessage: getErrorMessage(err)
  };
  taskErrors.push(taskError);
  console.error(`Error trying to perform task ${task} on item ${item}: ${taskError.errorMessage}`)
  if (taskErrors.length > maxTaskErrors) {
    throw "Exceeded maximum task errors";
  }
}