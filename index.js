'use strict';

var path = require('path');
var fs = require('fs');

var Trello = require('node-trello');
var pivotal = require('pivotal');
var log = require('npmlog');
var FormData = require('form-data');
var request = require('request');
var mime = require('mime');

var PROXY = process.env.PROXY || '';
var VERBOSE = process.env.VERBOSE;
var trelloAPI = 'https://api.trello.com';
var requiredLists = ['accepted', 'delivered', 'rejected', 'finished', 'current', 'backlog', 'icebox'];

if(PROXY){
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

function organizeLists(trelloLists){
  var list = trelloLists.reduce(function(a, list){
    a[list.name.toLowerCase()] = list;
    return a;
  }, {});
  return list;
}

function addChecklistsToCard(trello, cardId, tasks, name, cb){
  trello.post('/1/cards/'+cardId+'/checklists', function(err, checklist){
    if(err){
      return cb(err);
    }
    var _count = 0;

    var finished = function(err){
      ++_count;
      if(err){
        return cb(err);
      }
      if(_count === tasks.length){
        cb(null);
      }
    };

    tasks.forEach(function(task){
      if(VERBOSE){
        log.info('pivotal-to-trello', 'adding task: %s for %s', task.description, name);
      }
      var taskPayload = {
        name: task.description,
        pos: task.position,
        idChecklist: checklist.id,
        checked: task.complete
      };

      var checkItemURI = '/1/checklists/'+checklist.id+'/checkItems';
      trello.post(checkItemURI, taskPayload, finished);
    });
  });
}

function addCommentsToCard(trello, cardId, comments, name, cb){
  var _count = 0;

  var finished = function(err){
    ++_count;
    if(err){
      return cb(err);
    }
    if(_count === comments.length){
      cb(null);
    }
  };

  comments.forEach(function(comment){
    if(VERBOSE){
      log.info('pivotal-to-trello', 'adding comment: %s for %s', comment.text, name);
    }

    var commentPayload = {
      text: comment.text
    };
    trello.post('/1/cards/'+cardId+'/comments', commentPayload, finished);
  });
}

function addAttachmentsToCard(key, token, pivotal, cardId, attachments, name, cb){
  var _count = 0;
  var attachmentsURI = trelloAPI+'/1/cards/'+cardId+'/attachments?key='+key+'&token='+token;
  var finished = function(err){
    ++_count;
    if(err){
      log.error('pivotal-to-trello', err);
      return cb(err);
    }

    if(_count === attachments.length){
      cb(null);
    }
  };

  attachments.forEach(function(attachment){
    log.info('pivotal-to-trello', 'adding attachment: %s for %s', attachment.filename, name);

    var fn = path.join('/tmp', path.basename(attachment.filename));
    var s = fs.createWriteStream(fn);

    s.on('error', function(err){
      log.error('pivotal-to-trello', err);
    });

    s.on('close', function(){
      fs.readFile(fn, function(err, data){
        if(err){
          return finished(err);
        }

        var form = new FormData();
        form.append('name', attachment.filename);
        form.append('file', data, {contentType: mime.lookup(fn)});

        var req = request({
          method: 'POST',
          url: attachmentsURI,
          proxy: PROXY
        }, function(err, resp, body){
          if(err || resp.statusCode !== 200){
            log.error('pivotal-to-trello', 'Could not create attachment', err || resp.statusCode+' '+body);
            log.error('pivotal-to-trello', attachment);
            return finished();
          }
          log.info('pivotal-to-trello', 'Attached file');
          finished();
        });

        req.on('error', function(err){
          log.error('pivotal-to-trello', 'Could not create attachment', err);
          log.error('pivotal-to-trello', attachment);
          return finished();
        });

        form.pipe(req);
      });
    });

    request.get({
      url: attachment.url,
      proxy: PROXY,
      headers: {
        'X-TrackerToken': pivotal
      }}).pipe(s);
  });
}

function createTrelloCard(trello, key, token, pivotal, lists, story, storyIndex, cb){
  var destList = story.current_state.toLowerCase();
  if(destList === 'unscheduled'){
    destList = 'icebox';
  } else if(destList === 'unstarted'){
    destList = 'backlog';
  } else if(destList === 'started'){
    destList = 'current';
  }

  var trelloList = lists[destList].id;

  var labels = [story.story_type];

  if(story.labels){
    labels = labels.concat(story.labels);
  }

  var trelloPayload = {
    name: story.name,
    desc: story.description || '',
    labels: labels,
    pos: storyIndex,
    idList: trelloList
  };

  trello.post('/1/cards', trelloPayload, function(err, res){
    log.info('pivotal-to-trello', 'migrating', story.id, story.name);
    var tasks;
    var notes;
    var attachments;
    if(err){
      return cb(err);
    }
    var _count = 0;
    var _total = 1;

    var finished = function(err){
      ++_count;
      if(err){
        return cb(err);
      }
      if(_count === _total){
        cb(null);
      }
    };

    if(story.tasks && story.tasks.task){
      ++_total;
      tasks = Array.isArray(story.tasks.task) ? story.tasks.task : [story.tasks.task];
      addChecklistsToCard(trello, res.id, tasks, story.name, finished);
    }

    if(story.notes && story.notes.note){
      ++_total;
      notes = Array.isArray(story.notes.note) ? story.notes.note : [story.notes.note];
      addCommentsToCard(trello, res.id, notes, story.name, finished);
    }

    // if(story.attachments && story.attachments.attachment){
    //   ++_total;
    //   attachments = Array.isArray(story.attachments.attachment) ? story.attachments.attachment : [story.attachments.attachment];
    //   addAttachmentsToCard(key, token, pivotal, res.id, attachments, story.name, finished);
    // }

    finished();
  });
}

function readPivotalStories(pivotal, trello, opts, cb){
  var _count = 0;
  var _total;
  var lists = organizeLists(opts.lists);

  var finished = function(err){
    ++_count;
    if(err){
      return cb(err);
    }

    if(_count === _total){
      cb(null);
    }
  };

  pivotal.getStories(opts.from, {}, function(err, stories){
    if(err){
      return cb(err);
    }
    _total = stories.story.length;
    stories.story.forEach(function(story, storyIndex){
      createTrelloCard(trello, opts.trello_key, opts.trello_token, opts.pivotal, lists, story, storyIndex, finished);
    });
  });
}

function makeLists(needed, opts, trello, pivotal, cb){
  var _count = 0;

  var finished = function(){
    ++_count;
    if(_count === needed.length){
      readPivotalStories(pivotal, trello, opts, cb);
    }
  };

  needed.forEach(function(list){
    var listPayload = {
      name: list
    };

    trello.post('/1/boards/'+opts.to+'/lists', listPayload, function(err, res){
      if(err){
        return cb(err);
      }
      opts.lists.push(res);
      finished();
    });
  });
}

function verifyLists(lists, opts, trello, pivotal, cb){
  var needed = requiredLists.slice(0);
  if(Array.isArray(lists)){
    lists.forEach(function(list){
      var idx = needed.indexOf(list.name.toLowerCase());
      if(idx > -1){
        needed.splice(idx, 1);
        opts.lists.push(list);
      }
    });

    if(needed.length > 0){
      log.info('pivotal-to-trello', 'The following lists will be created:', needed.join(', '));
      makeLists(needed, opts, trello, pivotal, cb);
    } else {
      readPivotalStories(pivotal, trello, opts, cb);
    }
  } else {
    log.error('pivotal-to-trello', 'Sorry, there was an error with getting the lists on your board from Trello');
    process.exit(1);
  }
}

function getListsFromBoard(trello, opts, cb){
  trello.get('/1/boards/'+opts.to+'/lists', function(err, res){
    if(err){
      return cb(err);
    }
    return verifyLists(res, opts, trello, pivotal, cb);
  });
}

function importer(opts){
  opts.lists = [];
  var trello = new Trello(opts.trello_key, opts.trello_token);
  pivotal.useToken(opts.pivotal);

  getListsFromBoard(trello, opts, function(err){
    if(err){
      log.error('pivotal-to-trello', err);
      process.exit(1);
    }
    log.info('pivotal-to-trello', 'Finished');
  });
}

module.exports = importer;