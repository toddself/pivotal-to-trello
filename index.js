'use strict';

var Trello = require('node-trello');
var pivotal = require('pivotal');
var requiredLists = ['accepted', 'delivered', 'rejected', 'finished', 'current', 'backlog', 'icebox'];

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
      console.log('adding task:', task.description, 'for', name);
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
    console.log('adding comment:', comment.text,'for', name);
    var commentPayload = {
      text: comment.text
    };
    trello.post('/1/cards/'+cardId+'/comments', commentPayload, finished);
  });
}

function addAttachmentsToCard(trello, cardId, attachments, name, cb){
  var _count = 0;

  var finished = function(err){
    ++_count;
    if(err){
      return cb(err);
    }

    if(_count === attachments.length){
      cb(null);
    }
  };

  attachments.forEach(function(attachment){
    console.log('adding attachment:', attachment.filename, 'for', name);
    var attachmentPayload = {
      url: attachment.url,
      name: attachment.filename
    };
    trello.post('/1/cards/'+cardId+'/attachments', attachmentPayload, finished);
  });
}

function createTrelloCard(trello, lists, story, storyIndex, cb){
  if(story.id === '69812828'){
    console.log(story);
  }

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
    console.log('migrating', story.id, story.name);
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

    if(story.attachments && story.attachments.attachment){
      ++_total;
      attachments = Array.isArray(story.attachments.attachment) ? story.attachments.attachment : [story.attachments.attachment];
      addAttachmentsToCard(trello, res.id, attachments, story.name, finished);
    }

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
      createTrelloCard(trello, lists, story, storyIndex, finished);
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
      console.log('Not all boards exist', needed.join(', '));
      makeLists(needed, opts, trello, pivotal, cb);
    } else {
      readPivotalStories(pivotal, trello, opts, cb);
    }
  } else {
    console.log('Sorry, there was an error with getting the lists on your board from Trello');
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
      console.log(err);
      process.exit(1);
    }
    console.log('Finished');
  });
}

module.exports = importer;