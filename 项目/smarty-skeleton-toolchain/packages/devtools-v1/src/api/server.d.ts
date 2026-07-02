export declare function startServer({ desiredPort }?: {
    desiredPort?: number;
}): Promise<{
    port: number;
}>;
