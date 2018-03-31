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
const fs = require("fs");
const pivotal = require("pivotal");
const request = require("hyperquest");
const FormData = require("form-data");
const Trello = require("node-trello");
const tmp = require("tmp");
const sleep = require("sleep-promise");
const PROXY = process.env.PROXY || '';
const VERBOSE = process.env.VERBOSE || false;
const trelloAPI = process.env.TRELLO_API || 'https://api.trello.com';
const requiredLists = ['accepted', 'delivered', 'rejected', 'finished', 'current', 'backlog', 'icebox'];
if (PROXY) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
const taskErrors = [];
const maxTaskErrors = 25;
/** Run the import from Pivotal Tracker to Trello using the specified options */
function runImport(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Configure the Trello and Pivotal Tracker APIs
            console.log('Configuring API options');
            var trello = new Trello(opts.trello_key, opts.trello_token);
            pivotal.useToken(opts.pivotal);
            // Pull the stories down from Pivotal
            const pivotalStories = yield readPivotalStories(opts);
            console.log(`Retrieved ${pivotalStories.length} stories from Pivotal Tracker.`);
            // Create the required Trello lists
            let trelloLists = yield getTrelloListsFromBoard(opts, trello);
            let trelloListDictionary = yield verifyTrelloLists(opts, trello, trelloLists);
            console.log(`Retrieved ${trelloLists.length} lists from Trello`);
            // Copy the Pivotal stories over to the Trello cards
            console.log('Creating Trello cards');
            yield createTrelloCards(opts, trello, trelloListDictionary, pivotalStories);
            if (taskErrors.length) {
                console.error(`*** Processing encountered ${taskErrors.length} errors ***`);
                for (let taskError of taskErrors) {
                    console.error(`Task: ${taskError.task}, Item:${taskError.item}, Error: ${taskError.errorMessage}`);
                }
            }
            console.log('Finished');
        }
        catch (err) {
            try {
                console.error(JSON.stringify(err));
            }
            catch (_a) {
                console.error(getErrorMessage(err));
            }
        }
    });
}
exports.runImport = runImport;
/** Read the full set of stories from the source Pivotal project */
function readPivotalStories(opts) {
    var promise = new Promise((resolve, reject) => {
        pivotal.getStories(opts.from, {}, function (err, stories) {
            if (err) {
                reject(err);
            }
            else {
                resolve(Array.isArray(stories.story) ? stories.story : [stories.story]);
            }
        });
    });
    return promise;
}
/** Make sure that the required lists are present on the target trello board. */
function verifyTrelloLists(opts, trello, startingLists) {
    return __awaiter(this, void 0, void 0, function* () {
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
            console.log(`The following lists will be created: ${needed.join(', ')}`);
            for (const listName of needed) {
                const list = yield makeTrelloList(opts, trello, listName);
                lists[list.name] = list;
            }
        }
        return lists;
    });
}
/** Transform the lists into a dictionary object */
function organizeLists(trelloLists) {
    var dictionary = trelloLists.reduce(function (a, list) {
        a[list.name.toLowerCase()] = list;
        return a;
    }, {});
    return dictionary;
}
/** Makes and returns a Trello list */
function makeTrelloList(opts, trello, listName) {
    var boardUrl = '/1/boards/' + opts.to + '/lists';
    var listPayload = {
        name: listName
    };
    var promise = new Promise((resolve, reject) => {
        trello.post(boardUrl, listPayload, (err, list) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(list);
            }
        });
    });
    return promise;
}
/** Retrieve the existing set of lists on the Trello board */
function getTrelloListsFromBoard(opts, trello) {
    return new Promise((resolve, reject) => {
        trello.get('/1/boards/' + opts.to + '/lists', function (err, lists) {
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
function createTrelloCards(opts, trello, trelloListDictionary, pivotalStories) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`Creating ${pivotalStories.length} cards in Trello`);
        for (let i = 0; i < pivotalStories.length; i++) {
            const pivotalStory = pivotalStories[i];
            try {
                const trelloCard = yield retry(() => createTrelloCard(trello, trelloListDictionary, pivotalStory, i));
                yield attachCardData(opts, trello, pivotalStory, trelloCard);
            }
            catch (err) {
                handleTaskError('create card', pivotalStory.name, err);
            }
        }
    });
}
/** Create the Trello card, and bring over any associated items */
function createTrelloCard(trello, trelloListDictionary, story, storyIndex) {
    var destList = story.current_state.toLowerCase();
    if (destList === 'unscheduled') {
        destList = 'icebox';
    }
    else if (destList === 'unstarted') {
        destList = 'backlog';
    }
    else if (destList === 'planned') {
        destList = 'backlog';
    }
    else if (destList === 'started') {
        destList = 'current';
    }
    var trelloList = trelloListDictionary[destList];
    if (!trelloList) {
        console.error(`No list matching ${destList} was found for pivotal story ${story.name}`);
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
    var promise = new Promise((resolve, reject) => {
        trello.post('/1/cards', trelloPayload, function (err, card) {
            console.log(`migrating story id ${story.id}`);
            if (err) {
                reject(err);
            }
            else {
                resolve(card);
            }
        });
    });
    return promise;
}
function attachCardData(opts, trello, pivotalStory, trelloCard) {
    return __awaiter(this, void 0, void 0, function* () {
        if (pivotalStory.tasks && pivotalStory.tasks.task) {
            const tasks = Array.isArray(pivotalStory.tasks.task) ? pivotalStory.tasks.task : [pivotalStory.tasks.task];
            yield addChecklistsToTrelloCard(trello, trelloCard.id, tasks, pivotalStory.name);
        }
        if (pivotalStory.notes && pivotalStory.notes.note) {
            const notes = Array.isArray(pivotalStory.notes.note) ? pivotalStory.notes.note : [pivotalStory.notes.note];
            yield addCommentsToTrelloCard(trello, trelloCard.id, notes, pivotalStory.name);
        }
        // if (pivotalStory.attachments && pivotalStory.attachments.attachment) {
        //   const attachments = Array.isArray(pivotalStory.attachments.attachment) ? pivotalStory.attachments.attachment : [pivotalStory.attachments.attachment];
        //   await addAttachmentsToTrelloCard(opts, trello, pivotal, trelloCard.id, attachments, pivotalStory.name);
        // }
    });
}
/** Add any checklist items to the Trello card */
function addChecklistsToTrelloCard(trello, cardId, tasks, storyName) {
    return __awaiter(this, void 0, void 0, function* () {
        // we have to create a checklist itself before we can add items to it...
        const checklist = yield createTrelloChecklist(trello, cardId);
        console.log(`Adding ${tasks.length} checklists to card ${cardId}`);
        for (let checkItem of tasks) {
            try {
                yield retry(() => addTrelloChecklistItem(trello, checklist, checkItem, storyName));
            }
            catch (err) {
                handleTaskError('add checklist item', checkItem.description, err);
            }
        }
    });
}
/** Create a checklist in the Trello card */
function createTrelloChecklist(trello, cardId) {
    var promise = new Promise((resolve, reject) => {
        trello.post('/1/cards/' + cardId + '/checklists', function (err, checklist) {
            if (err) {
                reject(err);
            }
            else {
                resolve(checklist);
            }
        });
    });
    return promise;
}
/** Add an item to the Trello card's checklist */
function addTrelloChecklistItem(trello, checklist, task, storyName) {
    if (VERBOSE) {
        console.log(`adding checkItem: ${task.description} for ${storyName}`);
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
            }
            else {
                resolve();
            }
        });
    });
    return promise;
}
/** Add discussion history from a Pivotal story to the target Trello card. */
function addCommentsToTrelloCard(trello, cardId, notes, storyName) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`Adding ${notes.length} comments to card ${cardId}`);
        for (let note of notes) {
            try {
                yield retry(() => addCommentToTrelloCard(trello, cardId, note, storyName));
            }
            catch (err) {
                handleTaskError('add comment', note.text, err);
            }
        }
    });
}
/** Add a specific comment to the target Trello card. */
function addCommentToTrelloCard(trello, cardId, note, storyName) {
    if (VERBOSE) {
        console.log(`adding comment: ${note.text} for ${storyName}`);
    }
    var commentPayload = {
        text: note.text
    };
    var promise = new Promise((resolve, reject) => {
        trello.post('/1/cards/' + cardId + '/actions/comments', commentPayload, err => {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
    return promise;
}
function addAttachmentsToTrelloCard(opts, trello, pivotal, cardId, attachments, storyName) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`Adding ${attachments.length} attachments to trello card ${cardId}`);
        var attachmentsURI = trelloAPI + '/1/cards/' + cardId + '/attachments?key=' + opts.trello_key + '&token=' + opts.trello_token;
        for (const attachment of attachments) {
            try {
                yield retry(() => addAttachmentToTrelloCard(attachment, attachmentsURI, storyName));
            }
            catch (err) {
                handleTaskError('add attachment', attachment.fileName, err);
            }
        }
    });
}
/** Add an attachment from Pivotal Tracker to the corresponding Trello card. */
function addAttachmentToTrelloCard(attachment, attachmentsURI, storyName) {
    console.log(`adding attachment "${attachment.fileName}" for "${storyName}"`);
    const promise = new Promise((resolve, reject) => {
        var tmpFile = tmp.fileSync();
        var fileName = tmpFile.name;
        var s = fs.createWriteStream(fileName);
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
                var form = new FormData({});
                form.append('name', attachment.fileName);
                form.append('file', data, { filename: fileName });
                var headers = form.getHeaders();
                headers['content-length'] = form.getLengthSync();
                var req = request(attachmentsURI, {
                    method: 'POST',
                    headers: headers
                });
                req.on('error', function (err) {
                    console.error(`Could not create attachment ${attachment.fileName}: ${getErrorMessage(err)}`);
                    reject(err);
                });
                req.on('response', function (res) {
                    if (res.statusCode !== 200) {
                        console.error(`Could not create attachment ${attachment.fileName}: ${getErrorMessage(err)}`);
                        res.pipe(process.stderr);
                        reject(res.statusCode);
                    }
                    else {
                        resolve();
                    }
                });
                form.pipe(req);
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
    return promise;
}
function retry(action, retryCount = 5, delayInMs = 500) {
    return __awaiter(this, void 0, void 0, function* () {
        let i = 0;
        while (i < retryCount) {
            try {
                return yield action();
            }
            catch (err) {
                if (++i < retryCount) {
                    if (err.statusCode === 429) {
                        console.warn(`Encountered a rate limit error; delaying next call for four seconds.`);
                        yield sleep(4000);
                    }
                    else {
                        console.warn(`Encountered an error in retry block ${i}: "${getErrorMessage(err)}"`);
                        yield sleep(delayInMs * i);
                    }
                }
                else {
                    console.error(`Encountered a fatal error in retry block ${i} (bailing): "${getErrorMessage(err)}"`);
                    throw err;
                }
            }
        }
    });
}
function getErrorMessage(err) {
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
    }
    catch (_a) {
        return err;
    }
}
/** When an error occurs performing a specific task */
function handleTaskError(task, item, err) {
    const taskError = {
        task: task,
        item: item,
        errorMessage: getErrorMessage(err)
    };
    taskErrors.push(taskError);
    console.error(`Error trying to perform task ${task} on item ${item}: ${taskError.errorMessage}`);
    if (taskErrors.length > maxTaskErrors) {
        throw "Exceeded maximum task errors";
    }
}
//# sourceMappingURL=index.js.map