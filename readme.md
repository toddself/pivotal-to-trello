# pivotal-to-trello

An opinionated way to migrate a Pivotal Tracker project to a Trello board.  Will create the following lists (if they don't exist) on your Trello board:

* Icebox
* Backlog
* Current
* Finished
* Rejected
* Accepted
* Delivered

It will then migrate all the stories from your Pivotal project, their labels, tasks, comments and attachments, into Trello, mapping the Pivotal story state to the appropriate list.

The story type in Pivotal (chore, bug, story, epic), will be added as a label on the ticket as well.

## Usage

```
npm i -g pivotal-to-trello
pivotal-to-trello -k [trello key] -t [trello app token] -p [pivotal key] -f [pivotal project id] -b [trello board id]
```

## Warning
There are currently no tests. Please use at your own risk.

## License
Copyright © 2014 Todd Kennedy. Licensed for use under the [MIT License](/LICENSE)