export interface IOptions {
    trello_key: string;
    trello_token: string;
    pivotal: string;
    from: string;
    to: string;
}
/** Run the import from Pivotal Tracker to Trello using the specified options */
export declare function runImport(opts: IOptions): Promise<void>;
