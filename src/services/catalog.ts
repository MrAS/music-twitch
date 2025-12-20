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

    private save() {
        try {
            fs.writeJSONSync(config.system.allowedCatalogPath, this.items, { spaces: 2 });
            logger.info('Catalog saved.');
        } catch (error) {
            logger.error('Failed to save catalog', error);
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
            return terms.every((term) => text.includes(term));
        });
    }

    public getAll(): AllowedItem[] {
        return this.items;
    }

    public addItem(item: AllowedItem): void {
        const existing = this.getByKey(item.key);
        if (existing) {
            throw new Error(`Item with key "${item.key}" already exists`);
        }
        this.items.push(item);
        this.save();
    }

    public updateItem(key: string, updates: Partial<AllowedItem>): void {
        const index = this.items.findIndex(item => item.key.toLowerCase() === key.toLowerCase());
        if (index === -1) {
            throw new Error(`Item with key "${key}" not found`);
        }
        this.items[index] = { ...this.items[index], ...updates };
        this.save();
    }

    public deleteItem(key: string): void {
        const index = this.items.findIndex(item => item.key.toLowerCase() === key.toLowerCase());
        if (index === -1) {
            throw new Error(`Item with key "${key}" not found`);
        }
        this.items.splice(index, 1);
        this.save();
    }
}
