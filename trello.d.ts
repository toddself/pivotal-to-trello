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
  