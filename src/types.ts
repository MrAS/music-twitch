export interface AllowedSource {
    type: 'local_file' | 'youtube_url';
    path?: string;
    url?: string;
}

export interface AllowedItem {
    key: string;
    title: string;
    source: AllowedSource;
}

export interface EnqueuedItem extends AllowedItem {
    requestedBy: string;
}
