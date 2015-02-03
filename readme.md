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

Currently due to an issue in how creating attachments in Trello works, attachment migration is not working. I am working on resolving this issue with the engineers at Trello.

## Usage

```
node bin/pivotal-to-trello.js -k [trello key] -t [trello app token] -p [pivotal key] -f [pivotal project id] -b [trello board id]
```

### Optional parameters

- `-c, --clean-board`: remove all cards and labels from the Trello board before importing
- `-l, --labels "comma-separated strings"`: only import stories with at least one of the specified labels (ex: `"major,to fix for v1"`)

> To obtain a valid token from Trello, use the following link: https://trello.com/1/authorize?key=[appkey]&name=[appname]&expiration=1day&response_type=token&scope=read,write

## Testing
You'll need to create an `auth.json` file in the project root with the following structure:

```json
{
  "pivotal": "[YOUR PIVOTAL KEY]",
  "trello": }
    "key": "[YOUR TRELLO KEY]",
    "token": "[YOUR TRELLO TOKEN]",
    "board": "[TRELLO BOARD ID FOR TESTING]"
  }
}
```


```
git clone git@github.com:toddself/pivotal-to-trello
cd pivotal-to-trello
touch auth.json
vi auth.json
npm install
npm test
```

## License
Copyright © 2014 Todd Kennedy. Licensed for use under the [MIT License](/LICENSE)