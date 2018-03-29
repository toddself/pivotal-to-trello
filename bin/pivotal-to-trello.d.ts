declare var path: any;
declare var fs: any;
declare var minimist: any;
declare var importer: any;
declare var args: any;
interface IOptions {
    trello_key: string;
    trello_token: string;
    pivotal: string;
    from: string;
    to: string;
}
declare function main(): void;
