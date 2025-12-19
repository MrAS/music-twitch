import fs from 'fs-extra';
import { AllowedItem } from '../types';
import { config } from '../config';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

export class CatalogService {
    private items: AllowedItem[] = [];

    constructor() {
        this.reload();
    }

    public reload() {
        try {
            if (fs.existsSync(config.system.allowedCatalogPath)) {
                this.items = fs.readJSONSync(config.system.allowedCatalogPath);
                logger.info(`Loaded ${this.items.length} items from catalog.`);
            } else {
                logger.warn('Allowed catalog file not found.');
            }
        } catch (error) {
            logger.error('Failed to load catalog', error);
            this.items = [];
        }
    }

    public getByKey(key: string): AllowedItem | undefined {
        return this.items.find((item) => item.key.toLowerCase() === key.toLowerCase());
    }

    public search(query: string): AllowedItem[] {
        const terms = query.toLowerCase().split(' ').filter(t => t.trim() !== '');
        if (terms.length === 0) return [];

        return this.items.filter((item) => {
            const text = (item.key + ' ' + item.title).toLowerCase();
            // rigorous whitelist: must contain all search terms? or just match score?
            // simple "all terms present" logic
            return terms.every((term) => text.includes(term));
        });
    }

    public getAll(): AllowedItem[] {
        return this.items;
    }
}
