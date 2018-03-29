export interface IOptions {
    trello_key: string;
    trello_token: string;
    pivotal: string;
    from: string;
    to: string;
}
export declare function runImport(opts: IOptions): Promise<void>;
